"""State shared by one CLI run: the site, the change request, a cached tree."""

from __future__ import annotations

import os

from .client import Wiki, WikiError
from .ops import Batch
from .tree import Tree


class Session:
	def __init__(self, site: str | None, cr: str | None):
		self.site = site or os.environ.get("WIKI_SITE") or "default"
		self.wiki = Wiki(None if self.site == "default" else self.site)
		self._cr = cr or os.environ.get("WIKI_CR")
		self._tree: Tree | None = None

	@property
	def cr(self) -> str:
		if not self._cr:
			raise WikiError("no change request: pass -c NAME, or export WIKI_CR=NAME")
		return self._cr

	def tree(self) -> Tree:
		if self._tree is None:
			self._tree = Tree(self.wiki.tree(self.cr))
		return self._tree

	def apply(self, batch: Batch) -> dict | None:
		"""Send the batch at the tree's version. Prints one line per op."""
		if not batch.ops:
			print("nothing to change")
			return None
		res = self.wiki.apply(self.cr, batch.ops, self.tree().version)
		print("\n".join(batch.log))
		print(f"applied {len(batch.ops)} op(s) to {self.cr}, now v{res['current_version']}")
		self._tree = None
		return res

	def space(self, phrase: str) -> dict:
		"""Resolve a docname, route or name to exactly one Wiki Space."""
		spaces = self.wiki.spaces()
		p = phrase.strip().strip("/").lower()
		for test in (
			lambda s: s["name"].lower() == p,
			lambda s: (s["space_name"] or "").lower() == p,
			lambda s: (s["route"] or "").lower() == p,
			lambda s: p in (s["space_name"] or "").lower() or p in (s["route"] or "").lower(),
		):
			hits = [s for s in spaces if test(s)]
			if len(hits) == 1:
				return hits[0]
			if len(hits) > 1:
				raise WikiError(f"'{phrase}' matches several spaces:\n{format_spaces(hits)}")
		raise WikiError(f"no space matches '{phrase}'. Spaces:\n{format_spaces(spaces)}")


def format_spaces(spaces: list[dict]) -> str:
	rows = []
	for s in spaces:
		flags = (" [git-synced: read-only]" if s.get("git_synced") else "") + (
			"" if s.get("allow_contributions") else " [contributions off]"
		)
		rows.append(f"{s['name']}  /{s['route']}  {s['space_name']}{flags}")
	return "\n".join(rows)
