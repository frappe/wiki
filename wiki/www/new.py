import re
import frappe
from frappe.desk.form.load import get_comments

def get_context(context):
	context.no_cache = 1
	frappe.form_dict.edit = True
	frappe.form_dict.new = 'true'
	context.doc = frappe.get_doc('Wiki Page', frappe.form_dict.wiki_page)
	# context = context.doc.get_context(context)


	context.doc.verify_permission("read")

	try:
		boot = frappe.sessions.get()
	except Exception as e:
		boot = frappe._dict(status='failed', error = str(e))
		print(frappe.get_traceback())

	boot_json = frappe.as_json(boot)

	# remove script tags from boot
	boot_json = re.sub(r"\<script[^<]*\</script\>", "", boot_json)

	# TODO: Find better fix
	boot_json = re.sub(r"</script\>", "", boot_json)

	context.boot = boot_json
	wiki_settings = frappe.get_single("Wiki Settings")
	context.banner_image = wiki_settings.logo
	context.script = wiki_settings.javascript
	context.docs_search_scope = ""
	can_edit = frappe.session.user != "Guest"
	context.can_edit = can_edit
	context.show_my_account = False
	context.doc.set_crumbs(context)

	if not can_edit:
		context.doc.redirect_to_login("create")
	context.sidebar_items, context.docs_search_scope  = context.doc.get_sidebar_items(context)
	context.title = "New Wiki Page"
	context.doc.title='New Wiki Page'
	context.content_md = "New Wiki Page"
	context.content_html = "New Wiki Page"
	if frappe.form_dict.wiki_page_patch:
		context.wiki_page_patch = frappe.form_dict.wiki_page_patch
		context.doc.content = frappe.db.get_value(
			"Wiki Page Patch", context.wiki_page_patch, "new_code"
		)
		context.comments = get_comments(
			"Wiki Page Patch", frappe.form_dict.wiki_page_patch, "Comment"
		)
		context.content_md = context.doc.content
		context.content_html = frappe.utils.md_to_html(context.doc.content)
	return context

	


