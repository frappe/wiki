"""What the last sync of a folder left on the wiki, kept beside the folder.

`.wikictl-sync.json` maps each page path to the hash of the content the wiki
held after that sync. It belongs to one site and one wiki subtree. A record for
another target is ignored, so the first sync there treats every differing page
as a conflict.
"""

from __future__ import annotations

import json
from pathlib import Path

FILE = ".wikictl-sync.json"


class SyncState:
	def __init__(self, folder: Path, site: str, space_root: str, at: str):
		self.path = folder / FILE
		self.target = {"site": site, "space_root": space_root, "at": at}

	def load(self) -> dict[str, str]:
		if not self.path.exists():
			return {}
		data = json.loads(self.path.read_text())
		return data.get("pages", {}) if data.get("target") == self.target else {}

	def save(self, pages: dict[str, str]):
		merged = {**self.load(), **pages}
		self.path.write_text(json.dumps({"target": self.target, "pages": merged}, indent=1, sort_keys=True))
