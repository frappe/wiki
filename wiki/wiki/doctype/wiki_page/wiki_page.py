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
from urllib.parse import urlencode


class WikiPage(WebsiteGenerator):

	def before_save(self):

		details = frappe.db.get_values('Wiki Page',
			filters={'name':self.name },
			fieldname=['route', 'title'])

		if not details:
			return

		old_route, old_title = (details[0][0], details[0][1])

		if old_route != self.route:
			frappe.db.sql('Update `tabWiki Sidebar Item` set route = %s where item = %s and type = "Wiki Page"',
			(self.route, self.name) )
			self.clear_sidebar_cache()

		if old_title != self.title:
			frappe.db.sql('Update `tabWiki Sidebar Item` set title = %s where item = %s and type = "Wiki Page"',
			(self.title, self.name) )
			self.clear_sidebar_cache()


	def after_insert(self):
		frappe.cache().hdel("website_page", self.name)

		# set via the clone method
		if hasattr(frappe.local, 'in_clone') and frappe.local.in_clone:
			return

		revision = frappe.new_doc("Wiki Page Revision")
		revision.wiki_page = self.name
		revision.content = self.content
		revision.message = "Create Wiki Page"
		revision.insert()

	def clear_sidebar_cache(self):
		for key in frappe.cache().hgetall("wiki_sidebar").keys():
			frappe.cache().hdel("wiki_sidebar", key)

	def on_trash(self):
		for name in frappe.get_all(
			"Wiki Page Revision", {"wiki_page": self.name}, pluck="name"
		):
			frappe.delete_doc("Wiki Page Revision", name)
		for name in frappe.get_all(
			"Wiki Page Patch", {"wiki_page": self.name, "new": 0}, pluck="name"
		):
			patch = frappe.get_doc("Wiki Page Patch", name)
			try:
				patch.cancel()
			except frappe.exceptions.DocstatusTransitionError:
				pass
			patch.delete()

		for name in frappe.get_all(
			"Wiki Page Patch", {"wiki_page": self.name, "new": 1}, pluck="name"
		):
			frappe.db.set_value("Wiki Page Patch", name, "wiki_page", "")

		for name in frappe.get_all(
			"Wiki Sidebar Item", {"type": "Wiki Page", "item": self.name}, pluck="name"
		):
			frappe.delete_doc("Wiki Sidebar Item", name)

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
			frappe.local.response['type'] = 'redirect'
			frappe.local.response['location'] = '/login?' + urlencode({'redirect-to': frappe.request.url})
			raise frappe.Redirect

	def redirect_to_login(self, action):
		frappe.local.response['type'] = 'redirect'
		frappe.local.response['location'] = '/login?' + urlencode({'redirect-to': frappe.request.url})
		raise frappe.Redirect

	def set_breadcrumbs(self, context):
		context.add_breadcrumbs = True
		if frappe.form_dict:
			context.parents = [{"route": "/" + self.route, "label": self.title}]
		else:
			parents = []
			splits = self.route.split("/")
			if splits:
				for index, route in enumerate(splits[:-1], start=1):
					full_route = "/".join(splits[:index])
					wiki_page = frappe.get_all(
						"Wiki Page", filters=[["route", "=", full_route]], fields=["title"]
					)
					if wiki_page:
						parents.append({"route": "/" + full_route, "label": wiki_page[0].title})

				context.parents = parents

	def get_context(self, context):
		self.verify_permission("read")
		self.set_breadcrumbs(context)
		wiki_settings = frappe.get_single("Wiki Settings")
		context.navbar_search = wiki_settings.add_search_bar
		context.banner_image = wiki_settings.logo
		context.script = wiki_settings.javascript
		context.docs_search_scope = self.get_docs_search_scope()
		context.metatags = {"title": self.title}
		context.last_revision = self.get_last_revision()
		context.number_of_revisions = frappe.db.count(
			"Wiki Page Revision", {"wiki_page": self.name}
		)
		html = frappe.utils.md_to_html(self.content)
		context.content = html
		context.page_toc_html = html.toc_html
		context.show_sidebar = True
		context.hide_login = True
		context = context.update(
			{
				"post_login": [
					{"label": _("My Account"), "url": "/me"},
					{"label": _("Logout"), "url": "/?cmd=web_logout"},
					{
						"label": _("Contributions ") + get_open_contributions(),
						"url": "/contributions",
					},
					{
						"label": _("My Drafts ") + get_open_drafts(),
						"url": "/drafts",
					},
				]
			}
		)

	def get_docs_search_scope(self):
		sidebar = frappe.get_all(
			doctype="Wiki Sidebar Item",
			fields=["name", "parent"],
			filters=[["item", "=", self.route]],
		)
		topmost = ""
		if sidebar:
			topmost = frappe.get_doc("Wiki Sidebar", sidebar[0].parent).find_topmost(
				sidebar[0].parent
			)
		return topmost

	def get_sidebar_items(self, context):
		sidebar = frappe.get_all(
			doctype="Wiki Sidebar Item",
			fields=["name", "parent"],
			filters=[["item", "=", self.name]],
		)
		sidebar_html = ""
		topmost = "/"
		if sidebar:
			sidebar_html, topmost = frappe.get_doc("Wiki Sidebar", sidebar[0].parent).get_items()
		else:
			sidebar = frappe.db.get_single_value("Wiki Settings", "sidebar")
			if sidebar:

				sidebar_html, topmost = frappe.get_doc("Wiki Sidebar", sidebar).get_items()

			else:
				sidebar_html = ""

		return sidebar_html, topmost

	def get_last_revision(self):
		last_revision = frappe.db.get_value(
			"Wiki Page Revision", filters={"wiki_page": self.name}
		)
		return frappe.get_doc("Wiki Page Revision", last_revision)


	def clone(self, original, new):

		# used in after_insert of Wiki Page to resist create of Wiki Page Revision
		frappe.local.in_clone = True

		cloned_wiki_page = frappe.copy_doc(self, ignore_no_copy=True)
		cloned_wiki_page.route = cloned_wiki_page.route.replace(original, new)

		cloned_wiki_page.flags.ignore_mandatory = True
		cloned_wiki_page.save()

		items = frappe.get_all(
			"Wiki Page Revision",
			filters={"wiki_page": self.name,},
			fields=["name"],
			pluck="name",
			order_by="creation",
		)

		for item in items:
			revision = frappe.get_doc("Wiki Page Revision", item)
			new_revision = frappe.copy_doc(revision, ignore_no_copy=True)
			new_revision.wiki_page = cloned_wiki_page.name
			new_revision.save()
			self.update_time_and_user('Wiki Page Revision', new_revision.name, revision)
		self.update_time_and_user('Wiki Page', cloned_wiki_page.name, self)

		return cloned_wiki_page

	def update_time_and_user(self, dt, dn, new_doc):
		for field in ("modified", "modified_by", "creation", "owner"):
			frappe.db.set_value(dt, dn, field, new_doc.get(field))


def get_open_contributions():
	count = len(
		frappe.get_list("Wiki Page Patch", filters=[["status", "=", "Under Review"]],)
	)
	return f'<span class="count">{count}</span>'

def get_open_drafts():
	count = len(
		frappe.get_list("Wiki Page Patch", filters=[["status", "=", "Draft"], ["owner", '=', frappe.session.user]],)
	)
	return f'<span class="count">{count}</span>'

@frappe.whitelist()
def preview(content, name, new, type, diff_css=False):
	html = frappe.utils.md_to_html(content)
	if new:
		return {"html": html}
	from ghdiff import diff

	old_content = frappe.db.get_value("Wiki Page", name, "content")
	diff = diff(old_content, content, css=diff_css)
	return {
		"html": html,
		"diff": diff,
		"orignal_preview": frappe.utils.md_to_html(old_content),
	}


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
				filename = text_type(filename, "utf-8")
		else:
			mtype = headers.split(";")[0]
			filename = get_random_filename(content_type=mtype)

		_file = frappe.get_doc(
			{"doctype": "File", "file_name": filename, "content": content, "decode": True}
		)
		_file.save(ignore_permissions=True)
		file_url = _file.file_url
		if not frappe.flags.has_dataurl:
			frappe.flags.has_dataurl = True

		return '<img src="{file_url}"'.format(file_url=file_url)

	if content and isinstance(content, string_types):
		content = re.sub(r'<img[^>]*src\s*=\s*["\'](?=data:)(.*?)["\']', _save_file, content)
	return content


@frappe.whitelist()
def update(
	name,
	content,
	title,
	type,
	attachments="{}",
	message="",
	wiki_page_patch=None,
	new=False,
	new_sidebar="",
	new_sidebar_items="",
	sidebar_edited=False,
	draft=False
):
	from ghdiff import diff

	context = {"route": name}
	context = frappe._dict(context)
	if type == "Rich Text":
		content = extract_images_from_html(content)

	if new:
		new = True

	status = 'Draft' if draft else "Under Review"
	if wiki_page_patch:
		patch = frappe.get_doc("Wiki Page Patch", wiki_page_patch)
		patch.new_title = title
		patch.new_code = content
		patch.status = status
		patch.message = message
		patch.new = new
		patch.new_sidebar = new_sidebar
		patch.new_sidebar_items = new_sidebar_items
		patch.sidebar_edited = sidebar_edited
		patch.save()

	else:
		patch = frappe.new_doc("Wiki Page Patch")

		patch_dict = {
			"wiki_page": name,
			"status": status,
			"raised_by": frappe.session.user,
			"new_code": content,
			"message": message,
			"new": new,
			"new_title": title,
			"sidebar_edited": sidebar_edited,
			"new_sidebar_items": new_sidebar_items,
		}

		patch.update(patch_dict)

		patch.save()

		update_file_links(attachments, patch.name)


	out = frappe._dict()

	if frappe.has_permission(doctype="Wiki Page Patch", ptype="submit", throw=False) and not draft:
		patch.approved_by = frappe.session.user
		patch.status = "Approved"
		patch.submit()
		out.approved = True

	frappe.db.commit()
	if draft:
		out.route = 'drafts'
	elif not frappe.has_permission(doctype="Wiki Page Patch", ptype="submit", throw=False):
		out.route = 'contributions'
	elif hasattr(patch, 'new_wiki_page'):
		out.route = patch.new_wiki_page.route
	else:
		out.route = patch.wiki_page_doc.route

	return out

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


@frappe.whitelist(allow_guest=True)
def get_sidebar_for_page(wiki_page):
	sidebar = []
	context = frappe._dict({})
	matching_pages = frappe.get_all("Wiki Page", {"name": wiki_page})
	if matching_pages:
		sidebar, _ = frappe.get_doc(
			"Wiki Page", matching_pages[0].get("name")
		).get_sidebar_items(context)
	return sidebar


@frappe.whitelist()
def approve(wiki_page_patch):
	if not frappe.has_permission(doctype="Wiki Page Patch", ptype="submit", throw=False):
		frappe.throw(
			_("You are not permitted to approve, Please wait for a moderator to respond"),
			frappe.PermissionError,
		)

	patch = frappe.get_doc("Wiki Page Patch", wiki_page_patch)
	patch.approved_by = frappe.session.user
	patch.status = "Approved"
	patch.submit()
