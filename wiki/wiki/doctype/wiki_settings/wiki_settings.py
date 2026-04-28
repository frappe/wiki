# Copyright (c) 2020, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


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


@frappe.whitelist()
def get_all_spaces():
	return frappe.get_all("Wiki Space", pluck="route")
