import frappe
from frappe import _
from frappe.query_builder import DocType

from wiki.wiki.doctype.wiki_page.wiki_page import update


def get_context(context):
	context.no_cache = 1

	wiki_settings = frappe.get_single("Wiki Settings")
	context.banner_image = wiki_settings.logo
	context.script = wiki_settings.javascript
	context.docs_search_scope = ""
	can_edit = frappe.session.user != "Guest"
	context.can_edit = can_edit
	context.show_my_account = False

	context.doc = frappe.get_doc("Wiki Page", frappe.form_dict.wiki_page)
	context.doc.set_breadcrumbs(context)

	from ghdiff import diff

	revision = frappe.form_dict.compare
	context.title = "Revision: " + revision
	context.parents = [
		{"route": "/" + context.doc.route, "label": context.doc.title},
		{"route": "/" + context.doc.route + "/revisions", "label": "Revisions"},
	]

	revision = frappe.get_doc("Wiki Page Revision", revision)

	context.revision = revision

	WikiPageRevision = DocType("Wiki Page Revision")
	WikiPageRevisionItem = DocType("Wiki Page Revision Item")

	previous_revisions = (
		frappe.qb.from_(WikiPageRevision)
		.join(WikiPageRevisionItem)
		.on(WikiPageRevision.name == WikiPageRevisionItem.parent)
		.where(WikiPageRevisionItem.creation < revision.creation)
		.where(WikiPageRevisionItem.wiki_page == context.doc.name)
		.select(WikiPageRevision.content)
		.orderby(WikiPageRevision.creation)
		.run()
	)

	if not previous_revisions or not previous_revisions[-1]:
		return

	context.diff = diff(previous_revisions[-1][0], revision.content, css=False)

	return context


@frappe.whitelist()
def restore_wiki_revision(wiki_revision_name, wiki_page_name):
	if not frappe.has_permission(doctype="Wiki Page", ptype="update", throw=False):
		frappe.throw(
			_("You are not permitted to revert the Wiki Page"),
			frappe.PermissionError,
		)

	wiki_revision_content, wiki_revision_message = frappe.get_value(
		"Wiki Page Revision", wiki_revision_name, ["content", "message"]
	)
	wiki_patch_title, new_sidebar_items = frappe.get_value(
		"Wiki Page Patch", {"wiki_page": wiki_page_name}, ["new_title", "new_sidebar_items"]
	)

	update(
		name=wiki_page_name,
		content=wiki_revision_content,
		title=wiki_patch_title,
		type="Markdown",
		new_sidebar_items=new_sidebar_items,
		message=f"Revert to Wiki Revision {wiki_revision_name} ({wiki_revision_message})",
	)

	return frappe.get_value("Wiki Page", wiki_page_name, ["route"])
