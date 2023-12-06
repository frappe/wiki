# Copyright (c) 2023, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WikiFeedback(Document):
	pass


@frappe.whitelist(allow_guest=True)
def submit_feedback(name, feedback, rating, email=None):
	if feedback_name := frappe.db.get_value("Wiki Feedback", {"wiki_page": name}):
		doc = frappe.get_doc("Wiki Feedback", feedback_name)
		doc.append("response", {"rating": rating, "feedback": feedback, "email_id": email})
		doc.save()
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Wiki Feedback",
				"wiki_page": name,
			}
		)
		doc.append("response", {"rating": rating, "feedback": feedback, "email_id": email})
		doc.insert()
