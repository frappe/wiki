import frappe
from frappe import _
from frappe.utils import cint
from lxml.html.diff import htmldiff

from wiki.wiki.doctype.wiki_page.wiki_page import get_open_contributions


def get_context(context):
	if not frappe.has_permission("Wiki Page Patch", "write"):
		frappe.local.response["type"] = "redirect"
		frappe.local.response["location"] = "/login?redirect-to=/all-contributions"
		raise frappe.Redirect

	context.no_cache = 1
	context.show_sidebar = True
	context.patches = fetch_patches()
	return context


def fetch_patches(start=0, limit=10):
	patches = []
	wiki_page_patches = frappe.get_list(
		"Wiki Page Patch",
		["name", "message", "status", "raised_by", "modified", "wiki_page"],
		start=cint(start),
		limit=cint(limit),
		filters=[["status", "=", "Under Review"]],
	)

	for patch in wiki_page_patches:
		route = frappe.db.get_value("Wiki Page", patch.wiki_page, "route")
		wiki_space_name = frappe.get_value("Wiki Group Item", {"wiki_page": patch.wiki_page}, "parent")
		patch.space_name = (
			frappe.get_value("Wiki Space", wiki_space_name, "space_name") if wiki_space_name else ""
		)
		patch.edit_link = f"/{route}?editWiki=1&wikiPagePatch={patch.name}"
		patch.color = "orange"
		patch.modified = frappe.utils.pretty_date(patch.modified)
		patches.extend([patch])

	return patches


@frappe.whitelist()
def get_patches_api(start=0, limit=10):
	patches = fetch_patches(start, limit)
	return {"patches": patches}


@frappe.whitelist()
def update_patch_status(patch, status):
	if not frappe.has_permission("Wiki Page Patch", "write"):
		frappe.throw(_("You don't have permission to update patch status"))

	patch_doc = frappe.get_doc("Wiki Page Patch", patch)
	if status == "Approved":
		patch_doc.status = "Approved"
		patch_doc.approved_by = frappe.session.user
		patch_doc.submit()
	elif status == "Rejected":
		patch_doc.status = "Rejected"
		patch_doc.submit()

	return True


@frappe.whitelist()
def get_patch_diff(patch):
	if not frappe.has_permission("Wiki Page Patch", "write"):
		frappe.throw(_("You don't have permission to view this patch"))
	patch_doc = frappe.get_doc("Wiki Page Patch", patch)

	original_code = patch_doc.orignal_code or ""
	new_code = patch_doc.new_code or ""

	return {
		"diff": htmldiff(original_code, new_code),
		"raised_by": patch_doc.raised_by,
		"raised_on": frappe.utils.pretty_date(patch_doc.modified),
	}
