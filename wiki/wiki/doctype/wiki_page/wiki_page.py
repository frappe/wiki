# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import frappe
from frappe.website.website_generator import WebsiteGenerator


class WikiPage(WebsiteGenerator):
	def after_insert(self):
		revision = frappe.new_doc("Wiki Page Revision")
		revision.wiki_page = self.name
		revision.content = self.content
		revision.message = "Create Wiki Page"
		revision.insert()

	def set_route(self):
		if self.is_website_published() and not self.route:
			self.route = self.make_route()

		if self.route:
			self.route = self.route.strip("/.")[:2000]

		wiki_home_route = frappe.db.get_single_value("Wiki Settings", "home_route")
		if not self.route.startswith(wiki_home_route):
			self.route = wiki_home_route + "/" + self.route

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

	def get_context(self, context):
		wiki_settings = frappe.get_single('Wiki Settings')
		context.banner_image = wiki_settings.logo
		context.home_route = wiki_settings.home_route
		context.docs_search_scope = context.home_route
		context.can_edit = frappe.session.user != "Guest"

		if frappe.form_dict:
			context.parents = [{"route": "/" + self.route, "label": self.title}]
			context.add_breadcrumbs = True

		if frappe.form_dict.new:
			context.title = "New Wiki Page"
			return

		if frappe.form_dict.edit:
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
		sidebar = frappe.db.get_single_value("Wiki Settings", "sidebar")
		context.sidebar_items = frappe.get_doc("Website Sidebar", sidebar).get_items()
		context.last_revision = self.get_last_revision()
		context.number_of_revisions = frappe.db.count(
			"Wiki Page Revision", {"wiki_page": self.name}
		)
		html = frappe.utils.md_to_html(self.content)
		context.content = html
		context.page_toc_html = html.toc_html

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
def new(title, route, content):
	wiki_page = frappe.new_doc("Wiki Page")
	wiki_page.title = title
	wiki_page.route = route
	wiki_page.content = content
	wiki_page.published = True
	wiki_page.insert()

	frappe.response.location = "/" + wiki_page.route
	frappe.response.type = "redirect"


@frappe.whitelist()
def get_route(title):
	import re

	# lowercase
	route = title.lower()
	# remove special characters
	route = re.sub(r"[^0-9a-zA-Z]", " ", route)
	# spaces to hyphens
	route = "-".join(route.split())
	# limit to 2000 chars
	route = route.strip("/.")[:2000]

	wiki_home_route = frappe.db.get_single_value("Wiki Settings", "home_route")
	if not route.startswith(wiki_home_route + "/"):
		route = wiki_home_route + "/" + route

	return route
