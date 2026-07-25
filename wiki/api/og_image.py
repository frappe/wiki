# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Auto-generated Open Graph cards for Wiki Documents.

A page with no uploaded ``meta_image`` still deserves a branded link preview, so
we screenshot a hardcoded HTML card built from the page's own title, breadcrumb
trail and space branding.

Rendering goes through ``frappe.utils.preview``, which drives the same headless
Chromium the PDF generator already runs -- no extra dependency and no
microservice hop. That helper is deliberately *not* whitelisted (screenshotting
arbitrary HTML server-side is an SSRF surface), so it is only ever called here
with HTML we build ourselves.
"""

import glob
import hashlib
import os

import frappe
from frappe import _
from frappe.utils.preview import get_preview_from_html
from werkzeug.wrappers import Response

# Bumped whenever the card template or its token block changes; it is part of
# the cache fingerprint, so a bump invalidates every cached card for free.
TEMPLATE_VERSION = "1"

OG_WIDTH = 1200
OG_HEIGHT = 630

# Deepest ancestors shown in the card's breadcrumb trail.
MAX_BREADCRUMB_SEGMENTS = 2

CACHE_DIR_NAME = "wiki-og"

# A day in the browser, a week of serving stale while we regenerate. Contains
# "public" so frappe's process_response leaves it alone and skips flushing
# cookies onto what is meant to be a CDN-cacheable response.
CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800"


def _resolve_doc(route: str):
	"""Load the published, readable Wiki Document at ``route``.

	Mirrors the ``download_pdf`` preamble: both access checks raise
	``DoesNotExistError``, so a restricted page 404s instead of 403ing and we
	never leak that it exists.
	"""
	doc_name = frappe.db.get_value(
		"Wiki Document", {"route": route, "is_group": 0, "is_external_link": 0}, "name"
	)
	if not doc_name:
		frappe.throw(_("Page not found"), frappe.DoesNotExistError)

	doc = frappe.get_cached_doc("Wiki Document", doc_name)
	doc.check_space_access("read")
	doc.check_published()
	return doc


def _safe_asset_url(url: str | None) -> str:
	"""Allow only site-local, Chromium-readable asset paths into the card.

	The renderer fetches whatever the card's ``<img src>`` points at, so a
	remote URL would turn it into an outbound request, and ``/private/files``
	is unreadable to it anyway.
	"""
	if not url:
		return ""
	if url.startswith("/files/") or url.startswith("/assets/"):
		return url
	return ""


def _breadcrumb_trail(doc) -> str:
	"""Ancestor titles from the root group down to the page's parent.

	The root group is dropped (it stands for the space, which the card already
	names) and the trail is capped at the deepest few segments, ellipsized on
	the left when there were more.
	"""
	if not doc.lft:
		return ""

	# get_ancestors() is ordered closest-first; reverse for root-to-parent.
	ancestors = list(reversed(doc.get_ancestors() or []))[1:]
	if not ancestors:
		return ""

	titles = [frappe.get_cached_value("Wiki Document", name, "title") for name in ancestors]
	titles = [title for title in titles if title]

	trail = titles[-MAX_BREADCRUMB_SEGMENTS:]
	if len(titles) > len(trail):
		trail.insert(0, "…")
	return " / ".join(trail)


def _title_font_size(title: str) -> int:
	"""Pick the title size in Python so the card never depends on script
	execution having finished before Chromium captures the frame."""
	length = len(title or "")
	if length <= 40:
		return 76
	if length <= 80:
		return 60
	return 48


def _og_context(doc) -> dict:
	"""The complete set of inputs the card template consumes."""
	wiki_space = doc.get_wiki_space()
	logo_url = ""
	if wiki_space:
		space_doc = frappe.get_cached_doc("Wiki Space", wiki_space["name"])
		logo_url = _safe_asset_url(space_doc.light_mode_logo)

	title = doc.meta_title or doc.title or ""
	return {
		"title": title,
		"title_font_size": _title_font_size(title),
		"breadcrumb_trail": _breadcrumb_trail(doc),
		"space_name": (wiki_space.get("space_name") if wiki_space else "") or "",
		"logo_url": logo_url,
	}


def og_fingerprint(ctx: dict) -> str:
	"""Hash exactly the inputs the template consumes, and nothing else.

	Fingerprinting inputs rather than ``modified`` means a content-only edit
	leaves a still-correct card alone, while a title / breadcrumb / space-name /
	logo change invalidates on its own -- no invalidation hook anywhere.
	"""
	parts = [
		TEMPLATE_VERSION,
		ctx["title"],
		ctx["breadcrumb_trail"],
		ctx["space_name"],
		ctx["logo_url"],
		str(OG_WIDTH),
		str(OG_HEIGHT),
	]
	return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:12]


def _cache_dir() -> str:
	path = frappe.get_site_path("public", "files", CACHE_DIR_NAME)
	os.makedirs(path, exist_ok=True)
	return path


def _cache_path(doc_key: str, fp: str) -> str:
	return os.path.join(_cache_dir(), f"{doc_key}-{fp}.jpg")


def _read_cached(path: str) -> bytes | None:
	try:
		with open(path, "rb") as f:
			return f.read()
	except FileNotFoundError:
		return None


def _write_cached(path: str, data: bytes) -> None:
	"""Write through a temp file so a concurrent reader never sees a torn image."""
	tmp = f"{path}.tmp-{frappe.generate_hash(length=8)}"
	with open(tmp, "wb") as f:
		f.write(data)
	os.replace(tmp, path)


def _prune_old(doc_key: str, keep_fp: str) -> None:
	"""Drop this document's stale cards, so the directory holds one file per page."""
	keep = _cache_path(doc_key, keep_fp)
	for path in glob.glob(os.path.join(_cache_dir(), f"{doc_key}-*.jpg")):
		if path == keep:
			continue
		try:
			os.unlink(path)
		except OSError:
			pass


def clear_cached_cards(doc_key: str) -> None:
	"""Remove every cached card for a document (used when it is deleted)."""
	if not doc_key:
		return
	for path in glob.glob(os.path.join(_cache_dir(), f"{doc_key}-*.jpg")):
		try:
			os.unlink(path)
		except OSError:
			pass


def render_og_html(ctx: dict) -> str:
	"""Render the card markup.

	``frappe.render_template`` runs a sandboxed Jinja environment built
	*without* autoescape, so every interpolation in the template escapes
	explicitly with ``| e``. Without it a page titled ``"><img src=http://evil>``
	would make the screenshotter fetch an attacker-controlled URL.
	"""
	return frappe.render_template("templates/wiki/og_image.html", ctx)


def generate_og_bytes(ctx: dict) -> bytes:
	return get_preview_from_html(render_og_html(ctx), format="jpg", width=OG_WIDTH, height=OG_HEIGHT)


@frappe.whitelist(allow_guest=True)  # nosemgrep: frappe-semgrep-rules.rules.security.guest-whitelisted-method
def og_image(route: str, v: str | None = None):
	"""Serve the generated OG card for the page at ``route``.

	``v`` is a cache-buster for scrapers and CDNs only -- the fingerprint is
	always recomputed server-side, so a stale ``v`` still serves the current
	card instead of 404ing, and a crafted one cannot reach a different file.

	Returns a raw werkzeug Response (``frappe.handler`` passes those straight
	through) because ``frappe.local.response`` would attach a
	``Content-Disposition: attachment``, which no ``og:image`` consumer accepts.
	"""
	doc = _resolve_doc(route)
	ctx = _og_context(doc)
	fp = og_fingerprint(ctx)
	etag = f'"{fp}"'

	if frappe.request and frappe.request.headers.get("If-None-Match") == etag:
		return _cache_headers(Response(status=304), etag)

	path = _cache_path(doc.doc_key, fp)
	data = _read_cached(path)
	if data is None:
		data = generate_og_bytes(ctx)
		_write_cached(path, data)
		_prune_old(doc.doc_key, fp)

	response = Response()
	response.mimetype = "image/jpeg"
	response.data = data
	return _cache_headers(response, etag)


def _cache_headers(response: Response, etag: str) -> Response:
	response.headers["Cache-Control"] = CACHE_CONTROL
	response.headers["ETag"] = etag
	return response
