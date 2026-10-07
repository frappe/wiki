"""Every event Wiki sends to Pulse, with the properties `docs/telemetry.md`
puts on all of them."""

from contextlib import suppress

from frappe.utils import telemetry as frappe_telemetry

import wiki


def default_properties() -> dict:
	return {"app_version": wiki.__version__}


def capture(event: str, interval: str | None = None, **props):
	"""Send one event. Telemetry never fails the action it reports on."""
	with suppress(Exception):
		frappe_telemetry.capture(
			event,
			"wiki",
			properties={**default_properties(), **props},
			interval=interval,
		)


def error_kind(exception: BaseException) -> str:
	"""Bucket an exception by class, never by message — a message can carry a repo
	name or a token fragment."""
	import requests

	if isinstance(exception, requests.HTTPError):
		status = getattr(exception.response, "status_code", None)
		return "auth" if status in (401, 403, 404) else "other"
	if isinstance(exception, requests.RequestException):
		return "network"
	return "other"


def duration_bucket(seconds: float) -> str:
	"""Wall time as a bucket. A raw duration is a high-cardinality number; the
	decision it feeds ("is this affordable") only needs the band."""
	for limit, label in ((1, "lt_1s"), (3, "1_3s"), (10, "3_10s")):
		if seconds < limit:
			return label
	return "gt_10s"
