# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class WikiContentBlob(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		content: DF.LongText | None
		content_type: DF.Data | None
		created_at: DF.Datetime | None
		created_by: DF.Link | None
		hash: DF.Data
		size: DF.Int
	# end: auto-generated types

	pass
