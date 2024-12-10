import frappe


def check_app_permission():
	"""Check if user has permission to access the app (for showing the app on app screen)"""

	if frappe.session.user != "Administrator":
		return True

	roles = frappe.get_roles()
	if "Wiki Approver" in roles:
		return True

	return False
