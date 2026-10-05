"""What earlier syncs of a folder left on the wiki, kept beside the folder.

`.wikictl-sync.json` holds one record per change request: each path mapped to
the hash of what that sync wrote. It belongs to one site and one wiki subtree.

A record only says what the wiki holds when its change request is the current
one, or was merged. A record from a draft that was archived describes text that
never reached main, so it is not trusted.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

FILE = ".wikictl-sync.json"


class SyncState:
	def __init__(self, folder: Path, site: str, space_root: str, at: str):
		self.path = folder / FILE
		self.target = {"site": site, "space_root": space_root, "at": at}

	def load(self, cr: str, merged_at: Callable[[str], str | None]) -> dict[str, str]:
		"""The hash to expect per path: merged records in merge order, then this CR's.

		Main holds whatever merged last, which need not be what synced last."""
		runs = self._runs()
		merged = [(when, run) for run in runs if run["cr"] != cr and (when := merged_at(run["cr"]))]
		expected: dict[str, str] = {}
		for _, run in sorted(merged, key=lambda pair: pair[0]):
			expected.update(run["pages"])
		for run in runs:
			if run["cr"] == cr:
				expected.update(run["pages"])
		return expected

	def save(self, cr: str, pages: dict[str, str]):
		runs = self._runs()
		run = next((r for r in runs if r["cr"] == cr), None)
		if run is None:
			run = {"cr": cr, "pages": {}}
			runs.append(run)
		run["pages"].update(pages)
		self.path.write_text(json.dumps({"target": self.target, "runs": runs}, indent=1, sort_keys=True))

	def _runs(self) -> list[dict]:
		if not self.path.exists():
			return []
		data = json.loads(self.path.read_text())
		return data.get("runs", []) if data.get("target") == self.target else []
