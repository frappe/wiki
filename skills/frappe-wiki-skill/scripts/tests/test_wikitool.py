"""Offline tests for the parts of wikictl that hold logic.

python3 -m unittest discover -s skills/frappe-wiki-skill/scripts/tests
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wikitool.client import WikiError
from wikitool.local import read_folder, split_front_matter, title_from_slug
from wikitool.ops import Batch
from wikitool.state import SyncState
from wikitool.sync import SyncPlan, item_hash
from wikitool.tree import Tree
from wikitool.write_cmds import _ensure_parents, _group_key

ROOT = "aaaaaaaaaaaa"


def item(key, slug, title, children=(), group=False, deleted=False, order=0, parent_route="handbook"):
	route = f"{parent_route}/{slug}"
	return {
		"doc_key": key,
		"slug": slug,
		"title": title,
		"route": route,
		"is_group": int(group),
		"is_published": 1,
		"is_deleted": deleted,
		"order_index": order,
		"children": [dict(c, route=f"{route}/{c['slug']}") for c in children],
	}


def payload():
	install = item("cccccccccccc", "install", "Install")
	old = item("dddddddddddd", "old", "Old", deleted=True)
	guides = item("bbbbbbbbbbbb", "guides", "Guides", [install, old], group=True, order=1)
	intro = item("eeeeeeeeeeee", "intro", "Introduction", order=0)
	return {"root_group": ROOT, "operation_version": 7, "children": [guides, intro]}


class TreeTest(unittest.TestCase):
	def setUp(self):
		self.tree = Tree(payload())

	def test_paths_doc_keys_and_space_prefix_resolve(self):
		self.assertEqual(self.tree.get("guides/install").key, "cccccccccccc")
		self.assertEqual(self.tree.get("/handbook/guides/install").key, "cccccccccccc")
		self.assertEqual(self.tree.get("cccccccccccc").path, "guides/install")

	def test_deleted_pages_have_no_path_but_keep_their_key(self):
		self.assertIsNone(self.tree.find("guides/old"))
		self.assertTrue(self.tree.get("dddddddddddd").is_deleted)

	def test_miss_names_the_siblings(self):
		with self.assertRaisesRegex(WikiError, "Under 'guides': install"):
			self.tree.get("guides/instal")

	def test_render_follows_order_index_and_flags_deletions(self):
		lines = self.tree.render().splitlines()
		self.assertTrue(lines[0].startswith("intro  Introduction"))
		self.assertIn("[draft-deleted]", self.tree.render("guides"))

	def test_empty_path_is_the_space_root(self):
		self.assertEqual(self.tree.key_of(""), ROOT)


class LocalTest(unittest.TestCase):
	def test_front_matter_is_parsed_and_stripped(self):
		meta, body = split_front_matter("---\ntitle: Set up\norder: 2\npublished: false\n---\n\nBody\n")
		self.assertEqual(meta, {"title": "Set up", "order": 2, "published": False})
		self.assertEqual(body, "Body\n")

	def test_no_front_matter_keeps_text(self):
		self.assertEqual(split_front_matter("# Hi\n"), ({}, "# Hi\n"))

	def test_slug_titles(self):
		self.assertEqual(title_from_slug("install-guide"), "Install guide")

	def test_folder_order_then_name(self):
		with tempfile.TemporaryDirectory() as d:
			d = Path(d)
			(d / "b.md").write_text("b")
			(d / "a.md").write_text("a")
			(d / "z.md").write_text("---\norder: 1\n---\nz")
			(d / "grp").mkdir()
			(d / "grp" / "_group.md").write_text("---\ntitle: The group\n---\n")
			(d / "grp" / "x.md").write_text("x")
			nodes = read_folder(d)
		self.assertEqual([n.slug for n in nodes], ["z", "a", "b", "grp"])
		self.assertEqual(nodes[3].title, "The group")
		self.assertEqual([c.slug for c in nodes[3].children], ["x"])


class SyncTest(unittest.TestCase):
	def plan(self, files: dict, contents: dict, at="", reorder=False, last=None, force=False):
		with tempfile.TemporaryDirectory() as d:
			for rel, text in files.items():
				path = Path(d) / rel
				path.parent.mkdir(parents=True, exist_ok=True)
				path.write_text(text)
			local = read_folder(Path(d))
		return SyncPlan(Tree(payload()), contents.get, reorder, last, force).build(local, at)

	def test_unchanged_pages_send_nothing(self):
		p = self.plan({"install.md": "---\ntitle: Install\n---\nsame"}, {"cccccccccccc": "same"}, at="guides")
		self.assertEqual(p.batch.ops, [])
		self.assertEqual(p.unchanged, 1)

	def test_changed_content_and_title_go_in_one_update(self):
		last = {"guides/install": item_hash("Install", True, "old")}
		p = self.plan(
			{"install.md": "---\ntitle: Installing\n---\nnew"},
			{"cccccccccccc": "old"},
			at="guides",
			last=last,
		)
		self.assertEqual(p.batch.ops[0]["type"], "update_content")
		self.assertEqual(p.batch.ops[0]["title"], "Installing")

	def test_new_group_and_child_share_a_temp_key(self):
		p = self.plan({"faq/one.md": "1"}, {}, at="guides")
		group, page = p.batch.ops
		self.assertEqual(group["parent_key"], "bbbbbbbbbbbb")
		self.assertEqual(page["parent_key"], group["temp_key"])

	def test_wiki_only_pages_are_reported_not_deleted(self):
		p = self.plan({"new.md": "n"}, {}, at="guides")
		self.assertEqual(p.extras, ["guides/install"])
		self.assertNotIn("delete_node", [o["type"] for o in p.batch.ops])

	def test_reorder_only_when_asked_and_needed(self):
		files = {
			"guides/_group.md": "---\ntitle: Guides\norder: 1\n---\n",
			"intro.md": "---\ntitle: Introduction\n---\nI",
		}
		contents = {"eeeeeeeeeeee": "I"}
		files["guides/install.md"] = "---\ntitle: Install\n---\nsame"
		contents["cccccccccccc"] = "same"
		self.assertEqual(self.plan(files, contents, reorder=True).batch.ops[0]["type"], "reorder_children")
		self.assertEqual(self.plan(files, contents, reorder=False).batch.ops, [])

	def test_a_page_edited_on_the_wiki_is_a_conflict(self):
		last = {"guides/install": item_hash("Install", True, "what we wrote")}
		p = self.plan(
			{"install.md": "mine"}, {"cccccccccccc": "a person edited this"}, at="guides", last=last
		)
		self.assertEqual(p.conflicts, ["guides/install"])
		self.assertEqual(p.batch.ops, [])

	def test_no_sync_record_and_different_text_is_a_conflict(self):
		p = self.plan({"install.md": "mine"}, {"cccccccccccc": "theirs"}, at="guides")
		self.assertEqual(p.conflicts, ["guides/install"])

	def test_force_overwrites_and_records_the_new_hash(self):
		p = self.plan({"install.md": "mine"}, {"cccccccccccc": "theirs"}, at="guides", force=True)
		self.assertEqual(p.batch.ops[0]["type"], "update_content")
		self.assertEqual(p.synced["guides/install"], item_hash("Install", True, "mine"))

	def test_a_title_edited_on_the_wiki_is_a_conflict(self):
		# The wiki says "Install"; the last sync wrote "Setup" with the same text.
		last = {"guides/install": item_hash("Setup", True, "same")}
		p = self.plan(
			{"install.md": "---\ntitle: Setup\n---\nsame"}, {"cccccccccccc": "same"}, at="guides", last=last
		)
		self.assertEqual(p.conflicts, ["guides/install"])
		self.assertEqual(p.batch.ops, [])

	def test_a_group_edited_on_the_wiki_is_a_conflict_but_its_pages_still_sync(self):
		files = {"guides/_group.md": "---\ntitle: How-tos\n---\n", "guides/new.md": "n"}
		last = {"guides": item_hash("How-tos", True, "")}
		p = self.plan(files, {}, last=last)
		self.assertIn("guides", p.conflicts)
		self.assertEqual([o["slug"] for o in p.batch.ops if o["type"] == "create_node"], ["new"])

	def test_page_versus_group_mismatch_is_refused(self):
		with self.assertRaisesRegex(WikiError, "is a group on the wiki"):
			self.plan({"guides.md": "x"}, {})


class StateTest(unittest.TestCase):
	def test_only_the_current_and_merged_records_are_trusted(self):
		with tempfile.TemporaryDirectory() as d:
			state = SyncState(Path(d), "site", ROOT, "guides")
			state.save("merged-cr", {"a": "m", "b": "m"})
			state.save("archived-cr", {"a": "x", "c": "x"})
			state.save("current", {"b": "now"})
			got = state.load("current", lambda cr: cr == "merged-cr")
		self.assertEqual(got, {"a": "m", "b": "now"})

	def test_a_record_for_another_target_is_ignored(self):
		with tempfile.TemporaryDirectory() as d:
			SyncState(Path(d), "site", ROOT, "guides").save("cr", {"a": "h"})
			self.assertEqual(SyncState(Path(d), "site", ROOT, "other").load("cr", lambda cr: True), {})


class LocalOrderTest(unittest.TestCase):
	def test_a_non_number_order_names_the_file(self):
		with tempfile.TemporaryDirectory() as d:
			(Path(d) / "a.md").write_text("---\norder: first\n---\nx")
			(Path(d) / "b.md").write_text("---\norder: 2\n---\ny")
			with self.assertRaisesRegex(WikiError, "a.md: order must be a whole number"):
				read_folder(Path(d))


class ParentTest(unittest.TestCase):
	def setUp(self):
		self.tree = Tree(payload())

	def test_a_page_cannot_be_a_parent(self):
		with self.assertRaisesRegex(WikiError, "'intro' is a page"):
			_group_key(self.tree, "intro")
		with self.assertRaisesRegex(WikiError, "'guides/install' is a page"):
			_ensure_parents(self.tree, Batch(), "guides/install/deeper", create=True)

	def test_groups_and_the_root_can_be_parents(self):
		self.assertEqual(_group_key(self.tree, "guides"), "bbbbbbbbbbbb")
		self.assertEqual(_group_key(self.tree, ""), ROOT)


if __name__ == "__main__":
	unittest.main()
