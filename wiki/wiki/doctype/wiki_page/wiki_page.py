# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import frappe
from frappe import _
from frappe.website.utils import cleanup_page_name
from frappe.website.website_generator import WebsiteGenerator


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

	def update_page(self, title, content, edit_message):
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

	def get_context(self, context):
		self.verify_permission("read")

		wiki_settings = frappe.get_single("Wiki Settings")
		context.banner_image = wiki_settings.logo
		context.home_route = "wiki"
		context.docs_search_scope = "wiki"
		context.can_edit = frappe.session.user != "Guest"
		context.no_cache = 1

		if frappe.form_dict:
			context.parents = [{"route": "/" + self.route, "label": self.title}]
			context.add_breadcrumbs = True

		if frappe.form_dict.new:
			self.verify_permission("create")
			context.title = "New Wiki Page"
			return

		if frappe.form_dict.edit:
			self.verify_permission("write")
			context.title = "Editing " + self.title
			return

		if frappe.form_dict.revisions:
			context.title = "Revisions: " + self.title
			revisions = frappe.db.get_all(
				"Wiki Page Revision",
				filters={"wiki_page": self.name},
				fields=["message", "creation", "owner", "name"],
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
		context.sidebar_items = self.get_sidebar_items(context)
		context.last_revision = self.get_last_revision()
		context.number_of_revisions = frappe.db.count(
			"Wiki Page Revision", {"wiki_page": self.name}
		)
		html = frappe.utils.md_to_html(self.content)
		context.content = html
		context.page_toc_html = html.toc_html

	def get_sidebar_items(self, context):
		sidebar = frappe.db.get_single_value("Wiki Settings", "sidebar")
		print(context)
		sidebar = frappe.get_all(doctype="Wiki Sidebar Item",fields=["name", "parent"], filters=[["route", "=", context.route ]])
		print("sidebar"*50)
		print(sidebar)
		sidebar_items = frappe.get_doc("Wiki Sidebar", sidebar[0].parent).get_items()
		if frappe.session.user == "Guest":
			sidebar_items = [
				item for item in sidebar_items if item.get("group_title") != "Manage Wiki"
			]
		return sidebar_items

	def get_last_revision(self):
		last_revision = frappe.db.get_value(
			"Wiki Page Revision", filters={"wiki_page": self.name}
		)
		return frappe.get_doc("Wiki Page Revision", last_revision)


@frappe.whitelist()
def preview(content):
	return frappe.utils.md_to_html(content)


@frappe.whitelist(methods=["POST"])
def update(wiki_page, title, content, edit_message):
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
