import frappe
from frappe.core.doctype.file.utils import get_content_hash
from frappe.utils import cint


def get_tailwindcss_hash():
	tailwindcss_path = frappe.get_app_path("wiki", "public/css/tailwind.css")
	content = open(tailwindcss_path).read()
	return get_content_hash(content)


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


def get_wiki_space_for_route(route: str, published_only: bool = False):
	"""Return the wiki space whose route owns the given page route.

	Matches the longest wiki space route prefix, so a page route like
	`team/start-here` resolves to the `team` wiki space.
	"""
	if not route:
		return None

	normalized_route = route.strip("/")
	spaces = frappe.get_all("Wiki Space", fields=["name", "route", "is_published"])

	for space in sorted(spaces, key=lambda row: len((row.route or "").strip("/")), reverse=True):
		space_route = (space.route or "").strip("/")
		if not space_route:
			continue

		if normalized_route != space_route and not normalized_route.startswith(f"{space_route}/"):
			continue

		if published_only and not cint(space.is_published):
			continue

		return frappe.get_cached_doc("Wiki Space", space.name)

	return None


def get_wiki_space_allowed_roles(wiki_space) -> set[str]:
	"""Extract the configured role allowlist from a wiki space, if any."""
	if not wiki_space:
		return set()

	roles = wiki_space.get("roles") if hasattr(wiki_space, "get") else getattr(wiki_space, "roles", None)
	allowed_roles = set()

	for row in roles or []:
		role = row.get("role") if hasattr(row, "get") else getattr(row, "role", None)
		if role:
			allowed_roles.add(role)

	return allowed_roles


def has_wiki_space_access(wiki_space, user: str | None = None) -> bool:
	"""Check whether the user satisfies the wiki space role allowlist.

	If no roles are configured on the space, access falls back to the page-level
	guest/login behaviour.
	"""
	user = user or frappe.session.user

	if user == "Administrator":
		return True

	allowed_roles = get_wiki_space_allowed_roles(wiki_space)
	if not allowed_roles:
		return True

	return bool(allowed_roles.intersection(set(frappe.get_roles(user))))
