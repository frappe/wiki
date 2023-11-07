# Copyright (c) 2021, Frappe and contributors
# For license information, please see license.txt


import json

import frappe
from frappe import _
from frappe.desk.form.utils import add_comment
from frappe.model.document import Document
from frappe.website.utils import cleanup_page_name


class WikiPagePatch(Document):
	def before_save(self):
		if not self.new:
			self.orignal_code = frappe.db.get_value("Wiki Page", self.wiki_page, "content")

	def after_insert(self):
		add_comment_to_patch(self.name, self.message)
		frappe.db.commit()

	def on_submit(self):
		if self.status == "Rejected":
			return

		if self.status != "Approved":
			frappe.throw(_("Please approve/ reject the request before submitting"))

		self.wiki_page_doc = frappe.get_doc("Wiki Page", self.wiki_page)

		self.clear_sidebar_cache()

		if self.new:
			self.create_new_wiki_page()
			self.update_sidebars()
		else:
			self.update_old_page()

	def clear_sidebar_cache(self):
		if self.new or self.new_title != self.wiki_page_doc.title:
			for key in frappe.cache().hgetall("wiki_sidebar").keys():
				frappe.cache().hdel("wiki_sidebar", key)

	def create_new_wiki_page(self):
		self.new_wiki_page = frappe.new_doc("Wiki Page")

		wiki_page_dict = {
			"title": self.new_title,
			"content": self.new_code,
			"route": f"{self.wiki_page_doc.get_space_route()}/{cleanup_page_name(self.new_title)}",
			"published": 1,
			"allow_guest": self.wiki_page_doc.allow_guest,
		}

		self.new_wiki_page.update(wiki_page_dict)
		self.new_wiki_page.save()

	def update_old_page(self):
		self.wiki_page_doc.update_page(self.new_title, self.new_code, self.message, self.raised_by)

	def update_sidebars(self):
		if not hasattr(self, "new_sidebar_items") or not self.new_sidebar_items:
			self.new_sidebar_items = "{}"

		sidebars = json.loads(self.new_sidebar_items)

		sidebar_items = sidebars.items()
		if sidebar_items:
			idx = 0
			for sidebar, items in sidebar_items:
				for item in items:
					idx += 1
					if item["name"] == "new-wiki-page":
						item["name"] = self.new_wiki_page.name
						wiki_space_name = frappe.get_value(
							"Wiki Space", {"route": self.wiki_page_doc.get_space_route()}
						)

						wiki_space = frappe.get_doc("Wiki Space", wiki_space_name)
						wiki_space.append(
							"wiki_sidebars",
							{
								"wiki_page": self.new_wiki_page.name,
								"parent_label": list(sidebars)[-1],
							},
						)
						wiki_space.save()

					frappe.db.set_value(
						"Wiki Group Item", {"wiki_page": str(item["name"])}, {"parent_label": sidebar, "idx": idx}
					)

	@frappe.whitelist()
	def approve_patch(self):
		self.approved_by = frappe.session.user
		self.status = "Approved"
		self.save()
		return True

@frappe.whitelist()
def add_comment_to_patch(reference_name, content):
	email = frappe.session.user
	name = frappe.db.get_value("User", frappe.session.user, ["first_name"], as_dict=True).get(
		"first_name"
	)
	comment = add_comment("Wiki Page Patch", reference_name, content, email, name)
	comment.timepassed = frappe.utils.pretty_date(comment.creation)
	return comment
