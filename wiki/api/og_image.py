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
import re

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils.preview import get_preview_from_html
from werkzeug.wrappers import Response

# Bumped whenever the card template or its token block changes; it is part of
# the cache fingerprint, so a bump invalidates every cached card for free.
TEMPLATE_VERSION = "4"

OG_WIDTH = 1200
OG_HEIGHT = 630

# Deepest ancestors shown in the card's breadcrumb trail.
MAX_BREADCRUMB_SEGMENTS = 2

CACHE_DIR_NAME = "wiki-og"

# doc_key names the cache file, so it has to be safe as a path segment.
# WikiDocument.set_doc_key only enforces immutability on *update* — an insert
# keeps whatever the caller supplied — so it is not trustworthy input here.
DOC_KEY_PATTERN = re.compile(r"\A[a-zA-Z0-9]{1,32}\Z")

# Exactly what frappe serves the wiki page itself (frappe/website/utils.py's
# cache_html), so a card is never cacheable for longer, or by more parties, than
# the page whose title it shows.
#
# Deliberately not "public": the URL carries no identity, so a shared cache
# would keep serving a card — title, breadcrumb, space name — after the page is
# unpublished or the space's roles change, without a request ever reaching
# _resolve_doc again. A private cache is per-user, so it can only ever replay a
# card to someone who was already allowed to see it.
CACHE_CONTROL = "private, max-age=300, stale-while-revalidate=10800"

# Long enough to cover a cold Chromium spin-up, short enough that a crashed
# worker's lock frees itself quickly.
LOCK_TTL = 90

# How long a failed render is remembered, so later hits short-circuit instead
# of relaunching Chromium.
FAILURE_TTL = 600


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
		# app_switcher_logo is the one the reader header actually renders, so
		# it is the space's real mark; light_mode_logo is a v2 leftover kept as
		# a fallback for spaces that only ever set that one.
		logo_url = _safe_asset_url(space_doc.app_switcher_logo or space_doc.light_mode_logo)

	# The page's own title, not meta_title: the card is a visual object where
	# the title reads as a label for the page you are about to open, while
	# meta_title is written for search-result copy and is often keyword-padded.
	title = doc.title or ""
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
	"""Private, not public: nothing needs these web-reachable — og:image points
	at this endpoint, never at the file — and under public/files a card would
	outlive the authorization that produced it, still served by nginx after the
	page is unpublished or a space's roles change."""
	path = frappe.get_site_path("private", "files", CACHE_DIR_NAME)
	os.makedirs(path, exist_ok=True)
	return path


def _is_safe_doc_key(doc_key: str | None) -> bool:
	return bool(doc_key) and bool(DOC_KEY_PATTERN.match(doc_key))


def _cache_path(doc_key: str, fp: str) -> str:
	"""Build a document's cache path, refusing any key that could escape the
	cache directory. `fp` is our own sha256 digest; `doc_key` is not ours."""
	if not _is_safe_doc_key(doc_key):
		frappe.throw(_("Page not found"), frappe.DoesNotExistError)
	return os.path.join(_cache_dir(), f"{doc_key}-{fp}.jpg")


def _read_cached(path: str) -> bytes | None:
	try:
		# `path` only ever comes from _cache_path, which pins the directory and
		# validates doc_key against DOC_KEY_PATTERN. The endpoint's `v` param is
		# never used to look a file up.
		# nosemgrep: frappe-semgrep-rules.rules.security.frappe-security-file-traversal
		with open(path, "rb") as f:
			return f.read()
	except FileNotFoundError:
		return None


def _write_cached(path: str, data: bytes) -> None:
	"""Write through a temp file so a concurrent reader never sees a torn image."""
	tmp = f"{path}.tmp-{frappe.generate_hash(length=8)}"
	# Same as _read_cached: `path` is _cache_path output and the suffix is a
	# generated hash.
	# nosemgrep: frappe-semgrep-rules.rules.security.frappe-security-file-traversal
	with open(tmp, "wb") as f:
		f.write(data)
	os.replace(tmp, path)


def _card_files(doc_key: str) -> list[str]:
	"""Every cached card belonging to one document; nothing for a key we refuse
	to put in a glob."""
	if not _is_safe_doc_key(doc_key):
		return []
	return glob.glob(os.path.join(_cache_dir(), f"{doc_key}-*.jpg"))


def _prune_old(doc_key: str, keep_fp: str) -> None:
	"""Drop this document's stale cards, so the directory holds one file per page."""
	keep = _cache_path(doc_key, keep_fp)
	for path in _card_files(doc_key):
		if path == keep:
			continue
		try:
			os.unlink(path)
		except OSError:
			pass


def clear_cached_cards(doc_key: str) -> None:
	"""Remove every cached card for a document (used when it is deleted)."""
	for path in _card_files(doc_key):
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
	# The template path is a literal owned by this app; only `ctx` varies, and
	# every value it carries is escaped in the template.
	# nosemgrep: frappe-semgrep-rules.rules.security.frappe-ssti
	return frappe.render_template("templates/wiki/og_image.html", ctx)


def generate_og_bytes(ctx: dict) -> bytes:
	return get_preview_from_html(render_og_html(ctx), format="jpg", width=OG_WIDTH, height=OG_HEIGHT)


class CardBusy(Exception):
	"""Another worker holds the render lock for this card."""


class CardFailed(Exception):
	"""Rendering this card failed; the failure is negatively cached."""


def _lock_key(doc_key: str, fingerprint: str) -> str:
	return frappe.cache().make_key(f"wiki_og_lock:{doc_key}:{fingerprint}")


def _failure_key(doc_key: str, fingerprint: str) -> str:
	return frappe.cache().make_key(f"wiki_og_fail:{doc_key}:{fingerprint}")


def _generate_and_store(doc_key: str, ctx: dict, fingerprint: str, path: str) -> bytes:
	"""Render one card, at most once at a time across the whole bench.

	Chromium is expensive and its cold start is measured in seconds, so a
	crawler wave on a fresh page must not queue every worker behind it: the
	loser of the lock raises CardBusy and the caller answers 503 rather than
	waiting. A render that actually fails is remembered for FAILURE_TTL so the
	next hit short-circuits instead of relaunching Chromium.
	"""
	cache = frappe.cache()
	if cache.get(_failure_key(doc_key, fingerprint)):
		raise CardFailed

	lock = _lock_key(doc_key, fingerprint)
	if not cache.set(lock, b"1", nx=True, ex=LOCK_TTL):
		raise CardBusy

	try:
		data = generate_og_bytes(ctx)
	except Exception:
		cache.set(_failure_key(doc_key, fingerprint), b"1", ex=FAILURE_TTL)
		frappe.log_error("Wiki OG image generation failed")
		raise CardFailed
	finally:
		cache.delete(lock)

	_write_cached(path, data)
	_prune_old(doc_key, fingerprint)
	return data


def _cards_enabled() -> bool:
	return bool(frappe.get_cached_value("Wiki Settings", "Wiki Settings", "auto_generate_meta_images"))


def _has_card(doc) -> tuple[str, str] | None:
	"""``(path, fingerprint)`` for a document that should have a card, else None."""
	if doc.is_group or doc.is_external_link or not doc.is_published:
		return None
	if not doc.get_wiki_space():
		return None

	fingerprint = og_fingerprint(_og_context(doc))
	return _cache_path(doc.doc_key, fingerprint), fingerprint


def enqueue_og_warmup(doc) -> None:
	"""Queue a card render when a write moves the fingerprint.

	Serving stays lazy -- this only means the first crawler after a change is
	usually a cache hit. Nothing in the page render depends on the job.

	Merges need no special handling: _classify_changes counts title, slug,
	route, parent_key and is_published as metadata fields, so every change that
	moves the fingerprint merges through a full doc.save() and lands here. The
	content-only fast path bypasses hooks, but content is not a fingerprint
	input, so there is nothing to miss.

	Inserts are deliberately left to the lazy path: a page nobody has shared yet
	has no stale card to replace, and warming every insert would turn a git-sync
	import of a whole wiki into a Chromium storm. Bulk pre-generation is a
	separate problem.
	"""
	if not _cards_enabled():
		return

	before = doc.get_doc_before_save()
	if not before:
		return

	target = _has_card(doc)
	if not target:
		return

	path, _fingerprint = target
	if os.path.exists(path):
		previous = _has_card(before)
		if previous and previous[0] == path:
			return

	frappe.enqueue(
		"wiki.api.og_image.warm_og_image",
		name=doc.name,
		queue="short",
		job_id=f"wiki-og-{doc.name}",
		deduplicate=True,
		enqueue_after_commit=True,
	)


def warm_og_image(name: str) -> None:
	"""Render and cache a document's card ahead of the first request."""
	if not _cards_enabled():
		return

	doc = frappe.get_cached_doc("Wiki Document", name)
	target = _has_card(doc)
	if not target:
		return

	path, fingerprint = target
	if os.path.exists(path):
		return

	try:
		# Same lock and failure keys as the request path, so a worker and a
		# crawler never both launch Chromium for one card.
		_generate_and_store(doc.doc_key, _og_context(doc), fingerprint, path)
	except (CardBusy, CardFailed):
		# Serving never depends on the warm-up; the request path retries.
		pass


@frappe.whitelist(allow_guest=True)  # nosemgrep: frappe-semgrep-rules.rules.security.guest-whitelisted-method
@rate_limit(key="route", limit=60, seconds=60 * 60, ip_based=True)
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
	if not _cards_enabled():
		# The kill switch has to stop Chromium launching, not just stop the tag
		# being emitted -- otherwise a site that turned cards off still pays for
		# every crawler that remembers an old og:image URL.
		frappe.throw(_("Page not found"), frappe.DoesNotExistError)

	ctx = _og_context(doc)
	fp = og_fingerprint(ctx)
	etag = f'"{fp}"'

	if frappe.request and frappe.request.headers.get("If-None-Match") == etag:
		return _cache_headers(Response(status=304), etag)

	path = _cache_path(doc.doc_key, fp)
	data = _read_cached(path)
	if data is None:
		try:
			data = _generate_and_store(doc.doc_key, ctx, fp, path)
		except CardBusy:
			return _transient_response(503, {"Retry-After": "5"})
		except CardFailed:
			# A 404 og:image degrades to "no preview image" everywhere, and the
			# page render is never in this call path, so a broken Chromium
			# cannot break a wiki page.
			return _transient_response(404)

	response = Response()
	response.mimetype = "image/jpeg"
	response.data = data
	return _cache_headers(response, etag)


def _cache_headers(response: Response, etag: str) -> Response:
	response.headers["Cache-Control"] = CACHE_CONTROL
	response.headers["ETag"] = etag
	return response


def _transient_response(status: int, headers: dict | None = None) -> Response:
	response = Response(status=status)
	response.headers["Cache-Control"] = "no-store"
	for key, value in (headers or {}).items():
		response.headers[key] = value
	return response
