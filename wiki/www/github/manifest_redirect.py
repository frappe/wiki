# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Complete the GitHub App Manifest flow.

GitHub redirects here with `code` + `state` after the admin confirms App
creation. We verify the state (CSRF), convert the code into the new App's
config (id, client id/secret, webhook secret, private key), store them in
Wiki Settings, then bounce back to the settings form.
"""

import frappe
from frappe import _

from wiki.api import github

no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in to create a GitHub App."), frappe.PermissionError)
	if not frappe.has_permission("Wiki Settings", "write"):
		frappe.throw(_("You are not permitted to configure the GitHub App."), frappe.PermissionError)

	args = frappe.form_dict
	if args.get("error"):
		frappe.throw(
			_("GitHub App creation failed: {0}").format(args.get("error_description") or args.get("error"))
		)
	if not args.get("code") or not github.verify_oauth_state(args.get("state")):
		frappe.throw(_("Invalid or expired GitHub App creation. Please try again."))

	config = github.convert_app_manifest(args.get("code"))
	github.store_app_credentials(config)
	# GitHub redirects here via GET, which Frappe does not auto-commit — without
	# this the freshly-stored credentials roll back at the end of the request.
	frappe.db.commit()  # nosemgrep

	frappe.local.flags.redirect_location = "/app/wiki-settings?github_app_created=1"
	raise frappe.Redirect
