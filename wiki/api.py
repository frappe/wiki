import frappe
from frappe.translate import get_all_translations


@frappe.whitelist(allow_guest=True)
def get_translations() -> dict[str, str]:
	if frappe.session.user != "Guest":
		language = frappe.db.get_value("User", frappe.session.user, "language")

	if not language:
		language = frappe.db.get_single_value("System Settings", "language") or "en"

	return get_all_translations(language)
