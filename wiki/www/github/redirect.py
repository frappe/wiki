# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Complete the GitHub connect-account flow.

GitHub redirects here with `code` + `state`. We verify the state (CSRF), trade
the code for a user-to-server access token, cache it for this user, then bounce
back to the wiki where the repo picker reads it via `my_installations`.
"""

import frappe
from frappe import _
from frappe.utils import get_url

from wiki.api import github

no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in to connect your GitHub account."), frappe.PermissionError)

	args = frappe.form_dict
	if args.get("error"):
		frappe.throw(
			_("GitHub authorization failed: {0}").format(args.get("error_description") or args.get("error"))
		)
	if not args.get("code") or not github.verify_oauth_state(args.get("state")):
		frappe.throw(_("Invalid or expired GitHub authorization. Please try connecting again."))

	payload = github.exchange_oauth_code(args.get("code"), get_url("/github/redirect"))
	github.store_user_token(frappe.session.user, payload)
	# GitHub redirects here via GET, which Frappe does not auto-commit.
	frappe.db.commit()  # nosemgrep

	frappe.local.flags.redirect_location = "/wiki?github_connected=1"
	raise frappe.Redirect
