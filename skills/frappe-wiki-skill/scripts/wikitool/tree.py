"""A change request's page tree, addressable by slug path.

A path is the chain of slugs below the space root: `guides/setup/install`.
A leading `/`, or the space's own route as the first segment, is ignored, so
`/handbook/guides/setup` works too. A 12-character doc_key is accepted anywhere
a path is.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .client import WikiError

DOC_KEY = re.compile(r"^[0-9a-f]{12}$")


@dataclass
class Node:
	key: str
	slug: str
	title: str
	is_group: bool
	is_published: bool
	is_deleted: bool
	path: str
	parent: Node | None = None
	children: list[Node] = field(default_factory=list)


class Tree:
	def __init__(self, payload: dict, space_route: str = ""):
		self.root_key: str = payload["root_group"]
		self.version: int = int(payload.get("operation_version") or 0)
		self.space_route = space_route.strip("/") or _space_route(payload.get("children") or [])
		self.by_key: dict[str, Node] = {}
		self.by_path: dict[str, Node] = {}
		self.top = self._build(payload.get("children") or [], None)

	def find(self, ref: str) -> Node | None:
		if DOC_KEY.match(ref):
			return self.by_key.get(ref)
		return self.by_path.get(self.normalize(ref))

	def get(self, ref: str) -> Node:
		node = self.find(ref)
		if node is None:
			raise WikiError(f"no page at '{ref}'. {self.hint(ref)}")
		return node

	def children_of(self, path: str) -> list[Node]:
		return self.top if not path else self.get(path).children

	def key_of(self, path: str) -> str:
		"""doc_key for a parent path; the empty path is the space root."""
		return self.root_key if not path else self.get(path).key

	def normalize(self, ref: str) -> str:
		parts = [p for p in ref.strip().strip("/").split("/") if p]
		if parts and self.space_route and parts[0] == self.space_route:
			parts = parts[1:]
		return "/".join(parts)

	def render(self, under: str = "", depth: int | None = None) -> str:
		start = self.children_of(self.normalize(under))
		lines: list[str] = []
		self._render(start, 0, depth, lines)
		return "\n".join(lines) or "(empty)"

	def _render(self, nodes: list[Node], level: int, depth: int | None, out: list[str]):
		if depth is not None and level >= depth:
			return
		for n in nodes:
			flags = "".join(
				f" [{f}]"
				for f, on in (("draft-deleted", n.is_deleted), ("unpublished", not n.is_published))
				if on
			)
			name = n.slug + ("/" if n.is_group else "")
			out.append(f"{'  ' * level}{name}  {n.title}  ·{n.key}{flags}")
			self._render(n.children, level + 1, depth, out)

	def _build(self, raw: list[dict], parent: Node | None) -> list[Node]:
		nodes = []
		for item in sorted(raw, key=lambda r: r.get("order_index") or 0):
			path = f"{parent.path}/{item['slug']}" if parent else item["slug"]
			node = Node(
				key=item["doc_key"],
				slug=item["slug"],
				title=item.get("title") or "",
				is_group=bool(item.get("is_group")),
				is_published=bool(item.get("is_published")),
				is_deleted=bool(item.get("is_deleted")),
				path=path,
				parent=parent,
			)
			node.children = self._build(item.get("children") or [], node)
			self.by_key[node.key] = node
			if not node.is_deleted:
				self.by_path[path] = node
			nodes.append(node)
		return nodes

	def hint(self, ref: str) -> str:
		if not self.by_path:
			return "The space is empty."
		parts = self.normalize(ref).split("/")
		for i in range(len(parts) - 1, -1, -1):
			parent = "/".join(parts[:i])
			if parent == "" or parent in self.by_path:
				names = [n.slug for n in self.children_of(parent) if not n.is_deleted]
				return f"Under '{parent or '/'}': {', '.join(names) or 'nothing'}"
		return ""


def _space_route(top: list[dict]) -> str:
	"""Every route starts with the space's route; read it off any top-level page."""
	for item in top:
		route = (item.get("route") or "").strip("/")
		if "/" in route:
			return route.split("/", 1)[0]
	return ""
