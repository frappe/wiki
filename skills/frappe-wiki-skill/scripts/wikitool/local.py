"""Read a folder of markdown files as a page tree.

    guides/                 a group (slug "guides")
      _group.md             optional: front matter for the group (title, order)
      install.md            a page (slug "install")
      faq.md

A file may start with front matter:

    ---
    title: Install the app
    order: 2
    published: false
    ---

Without `title`, the slug is turned into one ("install-guide" → "Install guide").
Without `order`, items sort by name. The front matter is not sent to the wiki.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .client import WikiError

GROUP_FILE = "_group.md"


@dataclass
class LocalNode:
	slug: str
	title: str
	is_group: bool
	published: bool = True
	content: str = ""
	children: list[LocalNode] = field(default_factory=list)


def read_folder(folder: Path) -> list[LocalNode]:
	items = []
	for entry in folder.iterdir():
		if entry.name.startswith((".", "_")):
			continue
		if entry.is_dir():
			meta, _ = split_front_matter(_read(entry / GROUP_FILE))
			node = _node(entry.name, meta, True, "")
			node.children = read_folder(entry)
			items.append((_order(meta, entry / GROUP_FILE), entry.name, node))
		elif entry.suffix == ".md":
			meta, body = split_front_matter(entry.read_text())
			items.append((_order(meta, entry), entry.stem, _node(entry.stem, meta, False, body)))
	items.sort(key=lambda t: (t[0] is None, t[0] if t[0] is not None else 0, t[1]))
	return [node for _, _, node in items]


def read_page(file: Path) -> tuple[dict, str]:
	return split_front_matter(file.read_text())


def split_front_matter(text: str) -> tuple[dict, str]:
	if not text.startswith("---\n"):
		return {}, text
	end = text.find("\n---\n", 4)
	if end == -1:
		return {}, text
	meta = {}
	for line in text[4:end].splitlines():
		if ":" in line:
			key, value = line.split(":", 1)
			meta[key.strip()] = _value(value.strip())
	return meta, text[end + 5 :].lstrip("\n")


def title_from_slug(slug: str) -> str:
	words = slug.replace("_", "-").split("-")
	return " ".join(words).capitalize()


def _order(meta: dict, source: Path):
	order = meta.get("order")
	if order is not None and not isinstance(order, int):
		raise WikiError(f"{source}: order must be a whole number, got '{order}'")
	return order


def _node(slug: str, meta: dict, is_group: bool, body: str) -> LocalNode:
	return LocalNode(
		slug=slug,
		title=str(meta.get("title") or title_from_slug(slug)),
		is_group=is_group,
		published=meta.get("published", True) is not False,
		content=body,
	)


def _value(raw: str):
	if raw.lower() in ("true", "false"):
		return raw.lower() == "true"
	if raw.lstrip("-").isdigit():
		return int(raw)
	return raw.strip("\"'")


def _read(path: Path) -> str:
	return path.read_text() if path.exists() else ""
