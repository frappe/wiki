"""The daily site profile: what a site holds, not what someone clicked today.

A click event only describes a site where someone clicked. Most sites that run
Wiki installed it long ago and quietly read it, so the counts here are the only
thing that ever reports them -- and the denominator every other event is read
against.

One event, `site_profile`, capped at 4096 bytes of properties. It reads Wiki's
own tables and sends nothing when telemetry is off.
"""

import statistics
from bisect import bisect_right

import frappe
from frappe.utils import add_days, date_diff, now_datetime
from frappe.utils.telemetry import is_pulse_enabled, site_age

from wiki import analytics_store
from wiki.api.og_image import cached_card_count
from wiki.telemetry import capture

VIEW_WINDOW_DAYS = 30

AVATAR_STYLES = ("glass", "blobs", "waves", "loops")

OPEN_CR_STATUSES = ("Draft", "In Review", "Changes Requested", "Approved")

# Which block types a space writes with, from the markdown Wiki already stores.
# A body scan of every revision would answer this better and cost a full table
# read per revision; the current content of each document is the cheap answer,
# and the question ("does anyone use mermaid") does not need history.
#
# A PDF embed serializes as an image link to a .pdf, so `blocks_pdf` is a subset
# of `blocks_image`.
BLOCK_TESTS = {
	"blocks_mermaid": "%```mermaid%",
	"blocks_callout": "%:::%",
	"blocks_pdf": "%.pdf)%",
	"blocks_image": "%![%",
	# The delimiter row of a GFM table: `| --- |`, with or without alignment colons.
	"blocks_table": r"\|[[:space:]]*:?-{3,}",
}


def send_site_profile():
	"""Scheduled daily."""
	if not is_pulse_enabled():
		return
	capture("site_profile", **collect())


def collect() -> dict:
	spaces = frappe.get_all(
		"Wiki Space",
		fields=[
			"name",
			"root_group",
			"is_published",
			"git_synced",
			"enable_tabs",
			"allow_contributions",
			"enable_feedback_collection",
			"avatar",
			"space_icon",
			"app_switcher_logo",
			"avatar_style",
		],
	)
	return {
		**identity(),
		**timeline(),
		**space_counts(spaces),
		**mark_counts(spaces),
		**document_counts(spaces),
		**meta_image_counts(),
		**review_counts(),
		**people_counts(),
	}


def identity() -> dict:
	return {
		"frappe_cloud": bool(frappe.conf.get("fc_team")),
		"site_age_days": site_age() or 0,
		"wiki_installed_days_ago": days_since(
			frappe.db.get_value("Installed Application", {"app_name": "wiki"}, "creation")
		),
	}


def timeline() -> dict:
	return {
		"first_space_days_ago": days_since(oldest("Wiki Space")),
		"first_page_days_ago": days_since(oldest("Wiki Document", {"parent_wiki_document": ("is", "set")})),
		"last_merge_days_ago": days_since(
			frappe.db.get_value(
				"Wiki Change Request",
				{"merged_at": ("is", "set")},
				"merged_at",
				order_by="merged_at desc",
			)
		),
	}


def space_counts(spaces: list) -> dict:
	restricted = set(frappe.get_all("Wiki Space Role", pluck="parent", distinct=True))
	return {
		"spaces": len(spaces),
		"published_spaces": sum(1 for space in spaces if space.is_published),
		"restricted_spaces": sum(1 for space in spaces if space.name in restricted),
		"github_synced_spaces": sum(1 for space in spaces if space.git_synced),
		"spaces_with_tabs": sum(1 for space in spaces if space.enable_tabs),
		"spaces_accepting_contributions": sum(1 for space in spaces if space.allow_contributions),
		"spaces_with_feedback_on": sum(1 for space in spaces if space.enable_feedback_collection),
	}


def mark_counts(spaces: list) -> dict:
	"""Spaces by the mark they show, in the priority `lib/spaceIdentity.js`
	resolves: a generated avatar wins over an icon, an icon over an upload."""
	counts = {f"avatar_{kind}": 0 for kind in ("generated", "icon", "logo")}
	counts.update({f"avatar_{style}": 0 for style in AVATAR_STYLES})
	for space in spaces:
		if space.avatar:
			counts["avatar_generated"] += 1
			if space.avatar_style in AVATAR_STYLES:
				counts[f"avatar_{space.avatar_style}"] += 1
		elif space.space_icon:
			counts["avatar_icon"] += 1
		elif space.app_switcher_logo:
			counts["avatar_logo"] += 1
	return counts


def document_counts(spaces: list) -> dict:
	"""Documents by kind, their spread across spaces, and which blocks each
	space writes with -- one pass over one query.

	A document belongs to the space whose root group contains its nested-set
	position. `Wiki Document.wiki_space` is a denormalization not every document
	carries, so the tree is the only membership that is always right.
	"""
	roots = sorted(
		(root.lft, root.rgt, root.name)
		for root in frappe.get_all(
			"Wiki Document",
			filters={"name": ("in", [space.root_group for space in spaces if space.root_group])},
			fields=["name", "lft", "rgt"],
		)
	)
	starts = [root[0] for root in roots]

	per_space = dict.fromkeys((root[2] for root in roots), 0)
	block_spaces = {key: set() for key in BLOCK_TESTS}
	counts = dict.fromkeys(
		("documents", "published_documents", "documents_group", "documents_tab", "documents_external_link"),
		0,
	)

	for document in scan_documents():
		index = bisect_right(starts, document.lft) - 1
		inside = index >= 0 and document.lft <= roots[index][1]
		if inside and document.lft == roots[index][0]:
			continue  # the root group is scaffolding, not a document anyone wrote

		counts["documents"] += 1
		if document.is_published:
			counts["published_documents"] += 1
		if document.is_external_link:
			counts["documents_external_link"] += 1
		elif document.is_tab:
			counts["documents_tab"] += 1
		elif document.is_group:
			counts["documents_group"] += 1

		if not inside:
			continue
		space = roots[index][2]
		per_space[space] += 1
		for key in BLOCK_TESTS:
			if document.get(key):
				block_spaces[key].add(space)

	return {
		**counts,
		**spread(list(per_space.values())),
		**{key: len(spaces_using) for key, spaces_using in block_spaces.items()},
	}


def spread(sizes: list[int]) -> dict:
	"""How a wiki is split across its spaces: a median and a max, never a
	per-space list -- a list would name how big each space is, one row at a time."""
	return {
		"documents_per_space_median": int(statistics.median(sizes)) if sizes else 0,
		"documents_per_space_max": max(sizes, default=0),
	}


def scan_documents() -> list[frappe._dict]:
	"""Every document as flags only. The content itself never leaves the query:
	the block tests run in SQL and come back as booleans."""
	return frappe.db.sql(
		"""
		SELECT
			lft, is_group, is_tab, is_external_link, is_published,
			content LIKE %(blocks_mermaid)s AS blocks_mermaid,
			content LIKE %(blocks_callout)s AS blocks_callout,
			content LIKE %(blocks_pdf)s AS blocks_pdf,
			content LIKE %(blocks_image)s AS blocks_image,
			content REGEXP %(blocks_table)s AS blocks_table
		FROM `tabWiki Document`
		""",
		BLOCK_TESTS,
		as_dict=True,
	)


def meta_image_counts() -> dict:
	return {
		"meta_images_enabled": bool(frappe.db.get_single_value("Wiki Settings", "auto_generate_meta_images")),
		"documents_with_uploaded_meta_image": frappe.db.count("Wiki Document", {"meta_image": ("is", "set")}),
		"cached_cards": cached_card_count(),
	}


def review_counts() -> dict:
	return {
		"change_requests_open": frappe.db.count("Wiki Change Request", {"status": ("in", OPEN_CR_STATUSES)}),
		"change_requests_merged": frappe.db.count("Wiki Change Request", {"status": "Merged"}),
	}


def people_counts() -> dict:
	"""Who wrote and who read, over the last 30 days.

	Views come from the DuckDB mirror of `Web Page View` that the analytics
	dashboard already fills, so the scan adds no counting of its own. A site
	that has never ingested a view reports zeroes rather than failing the send.
	"""
	since = add_days(None, -VIEW_WINDOW_DAYS)
	editors = frappe.db.sql(
		"""
		SELECT COUNT(DISTINCT created_by) FROM `tabWiki Revision`
		WHERE creation >= %s AND created_by IS NOT NULL
		""",
		since,
	)[0][0]

	try:
		views, viewers = analytics_store.site_activity(since, now_datetime())
	except Exception:
		views, viewers = 0, 0

	return {
		"editors_last_30d": int(editors or 0),
		"viewers_last_30d": viewers,
		"views_last_30d": views,
	}


def oldest(doctype: str, filters: dict | None = None):
	return frappe.db.get_value(doctype, filters or {}, "creation", order_by="creation asc")


def days_since(value) -> int | None:
	return date_diff(None, value) if value else None
