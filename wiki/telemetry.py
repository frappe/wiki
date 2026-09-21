"""Every event Wiki sends to Pulse, with the properties `docs/telemetry.md`
puts on all of them."""

from contextlib import suppress

import frappe
from frappe.utils import telemetry as frappe_telemetry
from frappe.utils.caching import site_cache

import wiki


def default_properties() -> dict:
	return {"app_version": wiki.__version__, "entry": get_entry()}


def capture(event: str, interval: str | None = None, **props):
	"""Send one event. Telemetry never fails the action it reports on."""
	with suppress(Exception):
		frappe_telemetry.capture(
			event,
			"wiki",
			properties={**default_properties(), **props},
			interval=interval,
		)


@site_cache(ttl=24 * 60 * 60)
def get_entry() -> str:
	"""How the site came to run Wiki."""
	return "saas_trial" if frappe.conf.get("fc_team") else "self_hosted"
