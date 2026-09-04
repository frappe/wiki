"""Delete the stale `/wiki` SPA entry: a gitignored build artifact the rename left behind."""

import os

import frappe

STALE_ENTRY = ("www", "wiki.html")


def execute():
	path = os.path.join(frappe.get_app_path("wiki"), *STALE_ENTRY)
	if os.path.exists(path):
		os.remove(path)
