# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class WikiGitHubConnection(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		access_token: DF.Password | None
		expires_at: DF.Datetime | None
		github_login: DF.Data | None
		refresh_token: DF.Password | None
		refresh_token_expires_at: DF.Datetime | None
		user: DF.Link
	# end: auto-generated types

	pass
