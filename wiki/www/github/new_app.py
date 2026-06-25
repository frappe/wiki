# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Kick off the GitHub App Manifest flow (one-click App creation).

A permitted admin hits `/github/new_app`: we build a read-only-sync manifest and
mint a single-use CSRF state, then render an auto-submitting form that POSTs the
manifest to GitHub. GitHub creates the App and returns to `/github/manifest_redirect`.
"""

import json

import frappe
from frappe import _
from frappe.utils import get_url

from wiki.api import github

no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in to create a GitHub App."), frappe.PermissionError)
	if not frappe.has_permission("Wiki Settings", "write"):
		frappe.throw(_("You are not permitted to configure the GitHub App."), frappe.PermissionError)

	# GitHub rejects manifests whose webhook host isn't publicly reachable, so on
	# dev/localhost we create the App without one (set it later from the panel).
	webhook_url = get_url("/api/method/wiki.api.github.webhook")
	manifest = github.build_app_manifest(
		name=f"Wiki Sync ({frappe.local.site})",
		homepage_url=get_url(),
		redirect_url=get_url("/github/manifest_redirect"),
		callback_url=get_url("/github/redirect"),
		webhook_url=webhook_url if github.is_public_host(webhook_url) else None,
	)

	context.no_cache = 1
	context.action = github.manifest_create_url(frappe.form_dict.get("org"))
	context.state = github.new_oauth_state()
	context.manifest = json.dumps(manifest)
