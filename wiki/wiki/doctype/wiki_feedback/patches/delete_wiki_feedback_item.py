import frappe

def execute():
    for d in frappe.db.sql("select * from `tabWiki Feedback Item`"):
        frappe.get_doc(dict(
            doctype = "Wiki Feedback",
            status = "Open",
            rating = d.rating,
            feedback = d.feedback,
            email_id = d.email_id
        )).insert()

        frappe.db.sql("update `tabWiki Feedback` set creation = %s, modified = %s" % (d.creation, d.modified))

        # delete old
        frappe.db.sql("delete from `tabWiki Feedback` where name = %s" % d.parent)