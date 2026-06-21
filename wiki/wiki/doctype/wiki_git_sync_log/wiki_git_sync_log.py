# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class WikiGitSyncLog(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		commit_sha: DF.Data | None
		created_count: DF.Int
		deleted_count: DF.Int
		error: DF.Code | None
		finished_at: DF.Datetime | None
		log: DF.Code | None
		moved_count: DF.Int
		started_at: DF.Datetime | None
		status: DF.Literal["Running", "Success", "No Change", "Error"]
		updated_count: DF.Int
		wiki_space: DF.Link
	# end: auto-generated types

	pass
