import frappe
from frappe import _
from frappe.utils import cint

from wiki.utils import apply_changes, apply_markdown_diff, highlight_changes


def fetch_patches(start=0, limit=10):
	patches = []
	filters = [["status", "=", "Under Review"]]

	# Add space filter if provided in URL
	space = frappe.form_dict.get("space")
	if space:
		wiki_pages = frappe.get_all("Wiki Group Item", filters={"parent": space}, pluck="wiki_page")
		if wiki_pages:
			filters.append(["wiki_page", "in", wiki_pages])

	wiki_page_patches = frappe.get_list(
		"Wiki Page Patch",
		["name", "message", "status", "raised_by", "modified", "wiki_page"],
		start=cint(start),
		limit=cint(limit),
		filters=filters,
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
	original_doc = frappe.get_doc("Wiki Page", patch_doc.wiki_page)

	patch_md = patch_doc.orignal_code or ""
	original_md = "" if patch_doc.new else original_doc.content or ""
	modified_md = patch_doc.new_code or ""

	merge_old_content = apply_markdown_diff(patch_md, modified_md)[1]

	merge_new_content = apply_changes(original_md, merge_old_content)

	new_modified_md = apply_markdown_diff(original_md, merge_new_content)[1]

	return {
		"diff": highlight_changes(original_md, new_modified_md),
		"raised_by": patch_doc.raised_by,
		"raised_on": frappe.utils.pretty_date(patch_doc.modified),
		"merged_html": frappe.utils.md_to_html(merge_new_content),
	}
