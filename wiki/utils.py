import json
from functools import lru_cache

import frappe
from frappe.core.doctype.file.utils import get_content_hash


def lucide_svg(icon: str | None, css_class: str = "size-4") -> str:
	"""Inline SVG markup for a `lucide-*` class name, for public templates.

	The SPA renders these icons through frappe-ui's Tailwind plugin, which the
	reader's separate Tailwind v4 build can't load — so a `lucide-*` class in a
	public template would render as an empty box. Inlining the SVG here keeps
	both surfaces on the same icon set without shipping the whole pack's CSS.

	The lookup table covers the curated picker list only (see
	scripts/generate-public-lucide.mjs); anything else falls back to
	`lucide-hash`, mirroring SpaceIcon.vue.
	"""
	table = _lucide_table()
	inner = table.get(icon or "") or table.get("lucide-hash")
	if not inner:
		return ""
	return (
		f'<svg class="{frappe.utils.escape_html(css_class)}" viewBox="0 0 24 24" fill="none" '
		'stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" '
		f'aria-hidden="true">{inner}</svg>'
	)


# The table is generated at build time and never changes at runtime, so a
# process-lifetime cache is enough.
@lru_cache(maxsize=1)
def _lucide_table() -> dict:
	try:
		with open(frappe.get_app_path("wiki", "lucide_icons.json")) as f:
			return json.load(f)
	except (OSError, ValueError):
		return {}


def get_tailwindcss_hash():
	tailwindcss_path = frappe.get_app_path("wiki", "public/css/tailwind.css")
	content = open(tailwindcss_path).read()
	return get_content_hash(content)


def get_asset_hash(path: str) -> str:
	"""Content hash of a public asset, for cache-busting <script>/<link> tags.

	`path` is relative to the wiki app root, e.g. "public/js/pdf-viewer.js".
	Returns "" if the file can't be read so the tag still renders.
	"""
	# `path` is always a trusted literal from our own templates (never user input),
	# and is resolved under the wiki app root, so this is not a traversal vector.
	try:
		# nosemgrep: frappe-semgrep-rules.rules.security.frappe-security-file-traversal
		with open(frappe.get_app_path("wiki", *path.split("/"))) as f:
			return get_content_hash(f.read())
	except OSError:
		return ""


def check_app_permission():
	"""Check if user has permission to access the app (for showing the app on app screen)"""

	if frappe.session.user == "Administrator":
		return True

	roles = frappe.get_roles()
	if "Wiki Manager" in roles:
		return True

	return False


def add_wiki_user_role(doc, event=None):
	doc.add_roles("Wiki User")
