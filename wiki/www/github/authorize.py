# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Kick off the GitHub connect-account flow.

A logged-in user hits `/github/redirect`-bound OAuth: we mint a single-use CSRF
state, then 302 to GitHub's authorize screen. GitHub sends the user back to
`/github/redirect` to complete the exchange.
"""

import frappe
from frappe import _
from frappe.utils import get_url

from wiki.api import github

no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in to connect your GitHub account."), frappe.PermissionError)

	state = github.new_oauth_state()
	redirect_uri = get_url("/github/redirect")
	frappe.local.flags.redirect_location = github.build_authorize_url(state, redirect_uri)
	raise frappe.Redirect
