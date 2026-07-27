# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.website.utils import delete_page_cache


class WikiSettings(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		ask_for_contact_details: DF.Check
		default_wiki_space: DF.Autocomplete | None
		enable_feedback: DF.Check
		enable_table_of_contents: DF.Check
		feedback_submission_limit: DF.Int
		head_html: DF.Code | None
		javascript: DF.Code | None
	# end: auto-generated types

	def on_update(self):
		"""Drop the cached reader pages -- most of these settings are baked into them.

		head_html, javascript, the TOC toggle and the feedback switch all change
		markup that the page cache is holding verbatim.
		"""
		delete_page_cache()
		frappe.db.after_commit.add(delete_page_cache)


@frappe.whitelist()
def get_all_spaces():
	return frappe.get_all("Wiki Space", pluck="route")
