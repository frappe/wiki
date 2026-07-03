"""Mark all revision hashes stale after the hash formula change.

The tree hash now covers item metadata (title, route, is_group, is_published,
is_external_link, external_url) so metadata-only edits are detected as changes
(frappe/wiki#681). Stored hashes were computed with the old formula; comparing
an old-formula hash against a new-formula one would report phantom changes, so
every revision is flagged for lazy recomputation.
"""

import frappe
from frappe.query_builder import DocType


def execute():
	WikiRevision = DocType("Wiki Revision")
	frappe.qb.update(WikiRevision).set(WikiRevision.hashes_stale, 1).run()
