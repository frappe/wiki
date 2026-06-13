import frappe
from frappe.core.doctype.file.utils import get_content_hash


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
