import frappe
from frappe.query_builder import DocType


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
		{"route": "/" + context.doc.route + "?revisions=true", "label": "Revisions"},
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

	if not previous_revisions or not previous_revisions[0]:
		return

	context.diff = diff(previous_revisions[0][0], revision.content, css=False)

	return context
