# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt
"""Persisted record of every GitHub webhook delivery (audit + debug).

Mirrors press's ``GitHub Webhook Log``: the signature is verified and the payload
parsed in ``validate`` (so a forged delivery never persists), and ``handle_events``
dispatches the side effects. Today only a branch ``push`` drives a sync; the log
still records ignored events so "why didn't my push sync?" is answerable.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.query_builder import Interval
from frappe.query_builder.functions import Now


class WikiGitHubWebhookLog(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		branch: DF.Data | None
		event: DF.Data
		git_reference_type: DF.Literal["", "branch", "tag"]
		github_installation_id: DF.Data | None
		payload: DF.Code
		repository: DF.Data | None
		repository_owner: DF.Data | None
		signature: DF.Data | None
		synced_spaces: DF.SmallText | None
	# end: auto-generated types

	def validate(self):
		from wiki.api.github import _verify_signature

		secret = frappe.get_cached_doc("Wiki Settings").get_password(
			"github_webhook_secret", raise_exception=False
		)
		if not _verify_signature(self.payload.encode(), self.signature, secret):
			frappe.throw(_("Invalid webhook signature."), frappe.PermissionError)

		# Body is signature-verified (so genuinely from GitHub), but guard the parse
		# anyway: a corrupt body must still persist as an audit row rather than 500
		# and send GitHub into a retry loop. A non-dict payload simply has no fields.
		try:
			payload = frappe.parse_json(self.payload)
		except Exception:
			payload = {}
		if not isinstance(payload, dict):
			payload = {}
		self.github_installation_id = str((payload.get("installation") or {}).get("id") or "") or None
		repo = payload.get("repository") or {}
		self.repository = repo.get("full_name") or repo.get("name")
		self.repository_owner = (repo.get("owner") or {}).get("login")

		if self.event == "push":
			# refs/heads/<branch> or refs/tags/<tag>
			parts = (payload.get("ref") or "").split("/", 2)
			if len(parts) == 3 and parts[1] == "heads":
				self.git_reference_type = "branch"
				self.branch = parts[2]
			elif len(parts) == 3 and parts[1] == "tags":
				self.git_reference_type = "tag"

	def handle_events(self):
		"""Run the side effects for this delivery. Only branch pushes sync today."""
		if self.event == "push" and self.git_reference_type == "branch":
			self._enqueue_branch_sync()

	def _enqueue_branch_sync(self):
		from wiki.api.github import _spaces_for_push

		spaces = _spaces_for_push(self.repository, self.branch)
		for space_name in spaces:
			frappe.enqueue(
				"wiki.wiki.git_sync.sync_space",
				queue="long",
				job_name=f"wiki_git_sync:{space_name}",
				space_name=space_name,
				token=None,
				trigger="Webhook",
			)
		self.db_set("synced_spaces", "\n".join(spaces) or None, update_modified=False)

	@staticmethod
	def clear_old_logs(days=30):
		table = frappe.qb.DocType("Wiki GitHub Webhook Log")
		frappe.db.delete(table, filters=(table.creation < (Now() - Interval(days=days))))
