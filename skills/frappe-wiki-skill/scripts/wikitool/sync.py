"""Plan the ops that make a wiki subtree match a local folder.

Matching is by slug. Missing pages and groups are created, changed titles,
content and publish flags are updated. Pages that exist only on the wiki are
reported, never deleted: deletion cascades and is the caller's call.

A page someone edited on the wiki is not overwritten. `last` maps each path to
the content hash the previous sync left there. A page is replaced only when the
wiki still holds that content, or with `force`. Anything else is a conflict.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable

from .client import WikiError
from .local import LocalNode
from .ops import Batch
from .tree import Node, Tree


class SyncPlan:
	def __init__(
		self,
		tree: Tree,
		fetch_content: Callable[[str], str],
		reorder: bool = False,
		last: dict[str, str] | None = None,
		force: bool = False,
	):
		self.tree = tree
		self.fetch_content = fetch_content
		self.reorder = reorder
		self.last = last or {}
		self.force = force
		self.batch = Batch()
		self.extras: list[str] = []  # wiki paths with no local file
		self.conflicts: list[str] = []  # edited on the wiki since the last sync
		self.synced: dict[str, str] = {}  # path -> hash of the content the wiki will hold
		self.unchanged = 0

	def build(self, local: list[LocalNode], at: str = "") -> SyncPlan:
		at = self.tree.normalize(at)
		self._level(local, self.tree.key_of(at), self._live(self.tree.children_of(at)), at)
		return self

	def _level(self, local: list[LocalNode], parent_key: str, live: list[Node], base: str):
		live_by_slug = {n.slug: n for n in live}
		ordered_keys = []
		for index, wanted in enumerate(local):
			path = f"{base}/{wanted.slug}" if base else wanted.slug
			node = live_by_slug.get(wanted.slug)
			key = (
				self._create(wanted, parent_key, index, path)
				if node is None
				else self._update(wanted, node, path)
			)
			ordered_keys.append(key)
			self._level(wanted.children, key, self._live(node.children) if node else [], path)

		local_slugs = {w.slug for w in local}
		extra = [n for n in live if n.slug not in local_slugs]
		self.extras += [n.path for n in extra]
		if self.reorder and live:
			wanted_order = ordered_keys + [n.key for n in extra]
			if wanted_order != [n.key for n in live]:
				self.batch.reorder(parent_key, wanted_order, label=base or "/")

	def _create(self, wanted: LocalNode, parent_key: str, index: int, path: str) -> str:
		if not wanted.is_group:
			self.synced[path] = content_hash(wanted.content)
		return self.batch.create(
			parent_key,
			wanted.title,
			wanted.slug,
			group=wanted.is_group,
			content=wanted.content,
			published=wanted.published,
			index=index,
			label=path,
		)

	def _update(self, wanted: LocalNode, node: Node, path: str) -> str:
		if node.is_group != wanted.is_group:
			kind = "group" if node.is_group else "page"
			raise WikiError(f"'{path}' is a {kind} on the wiki but not locally; rename one side")
		if not wanted.is_group and not self._content_may_change(wanted, node, path):
			return node.key
		ops_before = len(self.batch.ops)
		fields = {}
		if node.title != wanted.title:
			fields["title"] = wanted.title
		if node.is_published != wanted.published:
			fields["is_published"] = int(wanted.published)
		if self.synced.get(path) != content_hash(wanted.content) and not wanted.is_group:
			self.batch.update_content(node.key, wanted.content, fields.pop("title", None), label=path)
			self.synced[path] = content_hash(wanted.content)
		if fields:
			self.batch.update_fields(node.key, fields, label=path)
		if len(self.batch.ops) == ops_before:
			self.unchanged += 1
		return node.key

	def _content_may_change(self, wanted: LocalNode, node: Node, path: str) -> bool:
		"""Record what the wiki holds. False means: leave this page alone."""
		on_wiki = content_hash(self.fetch_content(node.key))
		if on_wiki == content_hash(wanted.content) or self.force or self.last.get(path) == on_wiki:
			self.synced[path] = on_wiki
			return True
		self.conflicts.append(path)
		return False

	@staticmethod
	def _live(nodes: list[Node]) -> list[Node]:
		return [n for n in nodes if not n.is_deleted]


def content_hash(text: str) -> str:
	return hashlib.sha256(text.encode()).hexdigest()[:16]
