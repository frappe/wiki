import frappe


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
	previous_revision_content = frappe.db.get_value(
		"Wiki Page Revision",
		filters={"creation": ("<", revision.creation), "wiki_page": context.doc.name},
		fieldname=["content"],
		order_by="creation asc",
	)

	if not previous_revision_content:
		return

	context.diff = diff(previous_revision_content, revision.content, css=False)

	return context
