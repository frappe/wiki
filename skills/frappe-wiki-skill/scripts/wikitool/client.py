"""Talk to a Frappe Wiki site through frappectl.

Every call goes through `frappectl api method/<m> -X POST --input -` with a JSON
body on stdin. One transport means no flag quoting, and markdown of any length
travels safely.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from typing import Any

CR = "wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request"


class WikiError(RuntimeError):
	"""A server refusal or a precondition this tool enforces."""


class Wiki:
	"""The Wiki v3 change-request API, one method per server call."""

	def __init__(self, site: str | None):
		self.ctl = Frappectl(site)

	# spaces
	def spaces(self) -> list[dict]:
		return self.ctl.doc_list(
			"Wiki Space", ["name", "space_name", "route", "root_group", "allow_contributions", "git_synced"]
		)

	def capabilities(self, space: str) -> dict:
		return self.ctl.call("wiki.api.get_space_capabilities", space=space)

	def live_documents(self) -> list[dict]:
		return self.ctl.doc_list("Wiki Document", ["route", "title", "doc_key", "is_group", "is_published"])

	# change requests
	def create_cr(self, space: str, title: str) -> dict:
		return self._cr("create_change_request", wiki_space=space, title=title)

	def draft_cr(self, space: str, title: str | None) -> dict:
		return self._cr("get_or_create_draft_change_request", wiki_space=space, title=title)

	def list_crs(self, space: str, status: str | None = None) -> list[dict]:
		return self._cr("list_change_requests", wiki_space=space, status=status)

	def get_cr(self, cr: str) -> dict:
		return self._cr("get_change_request", name=cr)

	def is_outdated(self, cr: str) -> bool:
		return bool(self._cr("check_outdated", name=cr))

	def transition(self, cr: str, action: str):
		"""submit, approve, merge, withdraw or archive."""
		return self._cr(f"{action}_change_request", name=cr)

	def conflicts(self, cr: str) -> list[dict]:
		return self._cr("get_merge_conflicts", name=cr)

	# content
	def tree(self, cr: str) -> dict:
		return self._cr("get_cr_tree", name=cr)

	def page(self, cr: str, doc_key: str) -> dict:
		return self._cr("get_cr_page", name=cr, doc_key=doc_key)

	def diff(self, cr: str, doc_key: str | None = None):
		if doc_key:
			return self._cr("diff_change_request", name=cr, scope="page", doc_key=doc_key)
		return self._cr("diff_change_request", name=cr, scope="summary")

	def apply(self, cr: str, ops: list[dict], base_version: int) -> dict:
		res = self._cr("apply_cr_operations", name=cr, base_version=base_version, operations=ops)
		# A version conflict comes back as a normal response, not an error.
		if not res.get("ok"):
			raise WikiError(
				f"{res.get('error')}: {res.get('message', '')} (server is at v{res.get('current_version')})"
			)
		return res

	def _cr(self, method: str, **params):
		return self.ctl.call(f"{CR}.{method}", **{k: v for k, v in params.items() if v is not None})


class Frappectl:
	def __init__(self, site: str | None):
		if not shutil.which("frappectl"):
			raise WikiError("frappectl is not installed (uv tool install frappectl)")
		self.prefix = ["frappectl"] + (["-s", site] if site else [])

	def call(self, method: str, **params) -> Any:
		return self._run(["api", f"method/{method}", "-X", "POST", "--input", "-"], json.dumps(params))

	def doc_list(self, doctype: str, fields: list[str]) -> list[dict]:
		# Filtering happens in Python: `-f` filters on route proved unreliable.
		return self._run(["doc", "list", doctype, "--fields", ",".join(fields), "--all", "--json"])

	def _run(self, args: list[str], stdin: str | None = None) -> Any:
		proc = subprocess.run(self.prefix + args, input=stdin, capture_output=True, text=True)
		if proc.returncode != 0:
			lines = [ln for ln in proc.stderr.splitlines() if ln.startswith("error:")]
			raise WikiError((lines[0][7:] if lines else proc.stderr.strip()) or "frappectl failed")
		out = proc.stdout.strip()
		return json.loads(out) if out else None
