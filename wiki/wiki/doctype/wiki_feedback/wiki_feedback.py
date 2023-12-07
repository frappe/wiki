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

	if feedback_name := frappe.db.get_value("Wiki Feedback", {"wiki_page": name}):
		doc = frappe.get_doc("Wiki Feedback", feedback_name)
		if feedback_index:
			feedback_index = int(feedback_index)

			doc.response[feedback_index - 1].rating = rating
			doc.response[feedback_index - 1].feedback = feedback
			doc.response[feedback_index - 1].email_id = email
		else:
			doc.append("response", {"rating": rating, "feedback": feedback, "email_id": email})
		doc.save()
		return feedback_index if feedback_index else len(doc.response)
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Wiki Feedback",
				"wiki_page": name,
			}
		)
		doc.append("response", {"rating": rating, "feedback": feedback, "email_id": email})
		doc.insert()
		return 1
