# Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.utils import get_system_timezone

no_cache = 1
sitemap = 0

ROBOTS_DIRECTIVE = "noindex, nofollow"


def get_context():
	frappe.local.response_headers.set("X-Robots-Tag", ROBOTS_DIRECTIVE)
	csrf_token = frappe.sessions.get_csrf_token()
	frappe.db.commit()  # nosemgrep
	context = frappe._dict()
	context.boot = get_boot()
	context.boot.csrf_token = csrf_token
	return context


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_context_for_dev():
	if not frappe.conf.developer_mode:
		frappe.throw(frappe._("This method is only meant for developer mode"))
	return get_boot()


def get_boot():
	return frappe._dict(
		{
			"frappe_version": frappe.__version__,
			"site_name": frappe.local.site,
			"read_only_mode": frappe.flags.read_only,
			"system_timezone": get_system_timezone(),
		}
	)
