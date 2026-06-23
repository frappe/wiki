# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WikiRevisionItem(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		content_blob: DF.Link | None
		doc_key: DF.Data
		external_url: DF.Data | None
		is_deleted: DF.Check
		is_external_link: DF.Check
		is_group: DF.Check
		is_published: DF.Check
		order_index: DF.Int
		parent_key: DF.Data | None
		revision: DF.Link
		slug: DF.Data | None
		title: DF.Data | None
	# end: auto-generated types

	pass


def on_doctype_update():
	# Page lookups filter on (revision, doc_key); without this index the query
	# full-scans the table, which is slow once revisions accumulate (1M+ rows on docs.frappe.io).
	frappe.db.add_index("Wiki Revision Item", ["revision", "doc_key"])
