# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import frappe
import json
import re
from frappe import _
from frappe.website.utils import cleanup_page_name
from frappe.website.website_generator import WebsiteGenerator
from frappe.desk.form.load import get_comments
from frappe.core.doctype.file.file import get_random_filename
from six import PY2, StringIO, string_types, text_type

class WikiPage(WebsiteGenerator):
	def autoname(self):
		self.name = self.route

	def after_insert(self):
		revision = frappe.new_doc("Wiki Page Revision")
		revision.wiki_page = self.name
		revision.content = self.content
		revision.message = "Create Wiki Page"
		revision.insert()

	def on_trash(self):
		for name in frappe.get_all(
			"Wiki Page Revision", {"wiki_page": self.name}, pluck="name"
		):
			frappe.delete_doc("Wiki Page Revision", name)

	def set_route(self):
		if not self.route:
			self.route = "wiki/" + cleanup_page_name(self.title)

	def update_page(self, title, content, edit_message, raised_by=None):
		"""
		Update Wiki Page and create a Wiki Page Revision
		"""
		self.title = title
		if content != self.content:
			self.content = content
			revision = frappe.new_doc("Wiki Page Revision")
			revision.wiki_page = self.name
			revision.content = content
			revision.message = edit_message
			revision.raised_by = raised_by
			revision.insert()

		self.save()

	def verify_permission(self, permtype):
		if permtype == "read" and self.allow_guest:
			return True
		permitted = frappe.has_permission(self.doctype, permtype, self)
		if not permitted:
			action = permtype
			if action == "write":
				action = "edit"
			frappe.throw(
				_("Not Permitted to {0} Wiki Page").format(action), frappe.PermissionError
			)

	def redirect_to_login(self, action):
		frappe.throw(
			_("Not Permitted to {0} Wiki Page").format(action), frappe.PermissionError
		)

	def set_crumbs(self, context):
		context.add_breadcrumbs = True
		if frappe.form_dict:
			context.parents = [{"route": "/" + self.route, "label": self.title}]
		else:
			parents = []
			splits = self.route.split('/')
			if splits:
				for index, route in enumerate(splits[:-1], start=1):
					full_route = '/'.join(splits[:index])
					wiki_page = frappe.get_all('Wiki Page', filters=[['route','=',full_route]],fields=['title'])
					if wiki_page:
						parents.append({"route": "/" + full_route, "label": wiki_page[0].title})

				context.parents = parents

	def get_context(self, context):
		self.verify_permission("read")


		# TODO: Find better solution


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
		context.docs_search_scope = ""
		can_edit = frappe.session.user != "Guest"
		context.can_edit = can_edit
		context.no_cache = 1
		context.show_my_account = False
		self.set_crumbs(context)

		if frappe.form_dict.new:
			if not can_edit:
				self.redirect_to_login("create")
			context.sidebar_items, context.docs_search_scope  = self.get_sidebar_items(context)
			context.title = "New Wiki Page"
			self.title='New Wiki Page'
			self.content = "New Wiki Page"
			return

		if frappe.form_dict.edit:
			if not can_edit:
				self.redirect_to_login("edit")
			context.title = "Editing " + self.title
			if frappe.form_dict.wiki_page_patch:
				context.wiki_page_patch = frappe.form_dict.wiki_page_patch
				self.content = frappe.db.get_value(
					"Wiki Page Patch", context.wiki_page_patch, "new_code"
				)
				context.comments = get_comments(
					"Wiki Page Patch", frappe.form_dict.wiki_page_patch, "Comment"
				)

			context.content_md = self.content
			context.content_html = frappe.utils.md_to_html(self.content)
			context.sidebar_items, context.docs_search_scope  = self.get_sidebar_items(context)
			return

		if frappe.form_dict.revisions:
			context.title = "Revisions: " + self.title
			revisions = frappe.db.get_all(
				"Wiki Page Revision",
				filters={"wiki_page": self.name},
				fields=["message", "creation", "owner", "name", "raised_by"],
			)
			context.revisions = revisions
			return

		if frappe.form_dict.compare:
			from ghdiff import diff

			revision = frappe.form_dict.compare
			context.title = "Revision: " + revision
			context.parents = [
				{"route": "/" + self.route, "label": self.title},
				{"route": "/" + self.route + "?revisions=true", "label": "Revisions"},
			]

			revision = frappe.get_doc("Wiki Page Revision", revision)

			context.revision = revision
			previous_revision_content = frappe.db.get_value(
				"Wiki Page Revision",
				filters={"creation": ("<", revision.creation), "wiki_page": self.name},
				fieldname=["content"],
				order_by="creation asc",
			)

			if not previous_revision_content:
				return

			context.diff = diff(previous_revision_content, revision.content, css=False)
			return

		context.metatags = {"title": self.title}
		context.sidebar_items, context.docs_search_scope  = self.get_sidebar_items(context)
		context.last_revision = self.get_last_revision()
		context.number_of_revisions = frappe.db.count(
			"Wiki Page Revision", {"wiki_page": self.name}
		)
		html = frappe.utils.md_to_html(self.content)
		context.content = html
		context.page_toc_html = html.toc_html
		context.show_sidebar = True
		context.hide_login = True



	def get_sidebar_items(self, context):
		sidebar = frappe.get_all(
			doctype="Wiki Sidebar Item",
			fields=["name", "parent"],
			filters=[["item", "=", context.route]],
		)
		sidebar_items = []
		topmost = '/'
		if sidebar:
			sidebar_items, topmost = frappe.get_doc("Wiki Sidebar", sidebar[0].parent).get_items()
		else:
			sidebar = frappe.db.get_single_value("Wiki Settings", "sidebar")
			if sidebar:
				
				sidebar_items = frappe.get_doc("Wiki Sidebar", sidebar).get_items()
				
			else:
				sidebar_items = []

		# if frappe.session.user == "Guest":
		# 	sidebar_items = [
		# 		item for item in sidebar_items if item.get("group_title") != "Manage Wiki"
		# 	]
		return sidebar_items, topmost

	def get_last_revision(self):
		last_revision = frappe.db.get_value(
			"Wiki Page Revision", filters={"wiki_page": self.name}
		)
		return frappe.get_doc("Wiki Page Revision", last_revision)


@frappe.whitelist()
def preview(content, name, new, type):
	if type == "Rich-Text":
		content = to_markdown(content)
	html = frappe.utils.md_to_html(content)
	if new:
		return {"html": html}
	from ghdiff import diff

	old_content = frappe.db.get_value("Wiki Page", name, "content")
	diff = diff(old_content, content, css=False)
	return {"html": html, "diff": diff}


@frappe.whitelist(methods=["POST"])
def update(wiki_page, title, content, edit_message):
	content = to_markdown(content)
	wiki_page = frappe.get_doc("Wiki Page", wiki_page)
	wiki_page.update_page(title, content, edit_message)

	frappe.response.location = "/" + wiki_page.route
	frappe.response.type = "redirect"


@frappe.whitelist(methods=["POST"])
def new(title, content):
	wiki_page = frappe.new_doc("Wiki Page")
	wiki_page.title = title
	wiki_page.content = content
	wiki_page.published = True
	wiki_page.insert()

	frappe.response.location = "/" + wiki_page.route
	frappe.response.type = "redirect"

@frappe.whitelist()
def extract_images_from_html(content):
	frappe.flags.has_dataurl = False

	def _save_file(match):
		data = match.group(1)
		data = data.split("data:")[1]
		headers, content = data.split(",")

		if "filename=" in headers:
			filename = headers.split("filename=")[-1]

			# decode filename
			if not isinstance(filename, text_type):
				filename = text_type(filename, 'utf-8')
		else:
			mtype = headers.split(";")[0]
			filename = get_random_filename(content_type=mtype)


		_file = frappe.get_doc({
			"doctype": "File",
			"file_name": filename,
			"content": content,
			"decode": True
		})
		_file.save(ignore_permissions=True)
		file_url = _file.file_url
		if not frappe.flags.has_dataurl:
			frappe.flags.has_dataurl = True

		return '<img src="{file_url}"'.format(file_url=file_url)

	if content and isinstance(content, string_types):
		content = re.sub(r'<img[^>]*src\s*=\s*["\'](?=data:)(.*?)["\']', _save_file, content)
	return content


@frappe.whitelist()
def update(name, content, title, type, attachments="{}", message="", wiki_page_patch=None, new=False, new_sidebar = '', new_sidebar_items = ''):
	from ghdiff import diff
	context = {'route': name}
	context = frappe._dict(context)
	# wiki_page = frappe.get_doc('Wiki Page', name)
	# sidebar, _ = wiki_page.get_sidebar_items(context)
	# context.sidebar_items = sidebar
	# old_sidebar = frappe.render_template('wiki/wiki/doctype/wiki_page/templates/web_sidebar.html', context)
	if type == "Rich-Text":
		content = extract_images_from_html(content)
		content = to_markdown(content)

	if new:
		new = True

	if wiki_page_patch:
		patch = frappe.get_doc("Wiki Page Patch", wiki_page_patch)
		patch.new_title = title
		patch.new_code = content
		patch.status = "Under Review"
		patch.message = message
		patch.new= new
		patch.new_sidebar = new_sidebar
		# patch.old_sidebar_store = old_sidebar
		patch.new_sidebar_items = new_sidebar_items
		# patch.new_sidebar_store = new_sidebar
		patch.save()
		return

	patch = frappe.new_doc("Wiki Page Patch")

	patch_dict = {
		"wiki_page": name,
		"status": "Under Review",
		"raised_by": frappe.session.user,
		"new_code": content,
		"message": message,
		"new": new,
		"new_title": title,
		# 'new_sidebar_store' : new_sidebar,
		# 'old_sidebar_store' : old_sidebar,
		# 'new_sidebar_store' : new_sidebar,
		'new_sidebar_items' : new_sidebar_items,
	}

	patch.update(patch_dict)

	patch.save()

	update_file_links(attachments, patch.name)

	frappe.db.commit()

	return True


def update_file_links(attachments, name):

	for attachment in json.loads(attachments):
		file = frappe.get_doc("File", attachment.get("name"))
		file.attached_to_doctype = "Wiki Page Patch"
		file.attached_to_name = name
		file.save()


def get_source_generator(resolved_route, jenv):
	path = resolved_route.controller.split(".")
	path[-1] = "templates"
	path.append(path[-2] + ".html")
	path = "/".join(path)
	return jenv.loader.get_source(jenv, path)[0]


def get_source(resolved_route, jenv):
	if resolved_route.page_or_generator == "Generator":
		return get_source_generator(resolved_route, jenv)

	elif resolved_route.page_or_generator == "Page":
		return jenv.loader.get_source(jenv, resolved_route.template)[0]


def get_path_without_slash(path):
	return path[1:] if path.startswith("/") else path


def to_markdown(html):
	from html2text import html2text
	from six.moves import html_parser as HTMLParser

	text = html
	# try:
	# 	text = html2text(html or '', bodywidth=0)

	# except HTMLParser.HTMLParseError:
	# 	pass

	return text

@frappe.whitelist()
def get_sidebar_for_page(wiki_page):
	context = frappe._dict({})
	sidebar, _ = frappe.get_doc('Wiki Page', wiki_page).get_sidebar_items(context)
	context.sidebar_items = sidebar
	return frappe.render_template('wiki/wiki/doctype/wiki_page/templates/web_sidebar.html', context)