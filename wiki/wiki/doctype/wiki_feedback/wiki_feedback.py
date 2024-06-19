# Copyright (c) 2023, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import validate_email_address


class WikiFeedback(Document):
	pass


@frappe.whitelist(allow_guest=True)
def submit_feedback(name, feedback, rating, email=None, feedback_index=None):
	email = validate_email_address(email)
	doc = frappe.get_doc(
		{
			"doctype": "Wiki Feedback",
			"wiki_page": name,
			"rating": rating,
			"feedback": feedback,
			"email_id": email,
		}
	)
	doc.insert()
	return 1
