# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from wiki.wiki import git_sync
from wiki.wiki.git_sync import build_nodes, sync_space


def _make_synced_space(repo="acme/docs", branch="main", docs_subdir=""):
	"""Create a git-synced Wiki Space (fields are read_only in desk but set on insert)."""
	space = frappe.new_doc("Wiki Space")
	space.space_name = "Synced Space"
	space.route = f"synced-{frappe.generate_hash(length=6)}"
	space.git_synced = 1
	space.repo_full_name = repo
	space.branch = branch
	space.docs_subdir = docs_subdir
	space.insert()
	return space


class _FakeRepo:
	"""In-memory GitHub repo: paths → markdown content, with a head SHA.

	Patches the three module-level fetch helpers so the engine runs with no
	network. Blob SHAs are derived from path so the tree is self-consistent.
	"""

	def __init__(self, files: dict[str, str], head_sha="sha1"):
		self.files = dict(files)
		self.head_sha = head_sha

	def tree(self):
		entries = []
		seen_dirs = set()
		for path in self.files:
			parts = path.split("/")
			for i in range(1, len(parts)):
				d = "/".join(parts[:i])
				if d not in seen_dirs:
					seen_dirs.add(d)
					entries.append({"path": d, "type": "tree", "sha": f"tree:{d}"})
			entries.append({"path": path, "type": "blob", "sha": f"blob:{path}"})
		return entries

	def blob(self, sha):
		path = sha.split("blob:", 1)[1]
		return self.files[path]

	def install(self, monkeypatch_target):
		git_sync._fetch_head_sha = lambda repo, branch, token=None: self.head_sha
		git_sync._fetch_tree = lambda repo, ref, token=None: self.tree()
		git_sync._fetch_blob = lambda repo, sha, token=None: self.blob(sha)


class TestGitSyncInference(FrappeTestCase):
	def test_build_nodes_classifies_folders_files_and_landings(self):
		files = {
			"docs/intro.md": "# Introduction\nhello",
			"docs/guides/setup.md": "# Setup\nsteps",
			"docs/guides/README.md": "# Guides\nlanding",
		}
		repo = _FakeRepo(files)
		repo.install(self)

		nodes, root_content, root_landing = build_nodes("acme/docs", repo.tree(), "docs")

		by_path = {n["source_path"]: n for n in nodes}
		# Folder "guides" is a group whose content comes from its README landing.
		self.assertEqual(by_path["docs/guides"]["is_group"], 1)
		self.assertEqual(by_path["docs/guides"]["title"], "Guides")
		self.assertIn("landing", by_path["docs/guides"]["content"])
		# README is NOT emitted as a standalone page.
		self.assertNotIn("docs/guides/README.md", by_path)
		# Leaf pages keep their H1 as title.
		self.assertEqual(by_path["docs/intro.md"]["title"], "Introduction")
		self.assertEqual(by_path["docs/guides/setup.md"]["is_group"], 0)
		# No repo-root landing here.
		self.assertIsNone(root_content)
		self.assertIsNone(root_landing)

	def test_build_nodes_falls_back_to_humanized_filename(self):
		files = {"docs/getting-started.md": "no heading here"}
		repo = _FakeRepo(files)
		repo.install(self)
		nodes, _, _ = build_nodes("acme/docs", repo.tree(), "docs")
		self.assertEqual(nodes[0]["title"], "Getting Started")

	def test_build_nodes_root_landing_detected(self):
		files = {"README.md": "# Home\nwelcome", "page.md": "# Page"}
		repo = _FakeRepo(files)
		repo.install(self)
		nodes, root_content, root_landing = build_nodes("acme/docs", repo.tree(), "")
		self.assertEqual(root_landing, "README.md")
		self.assertIn("welcome", root_content)
		self.assertEqual([n["source_path"] for n in nodes], ["page.md"])


class TestGitSyncApply(FrappeTestCase):
	def tearDown(self):
		frappe.db.rollback()

	def _tree(self, space):
		root_lft, root_rgt = frappe.db.get_value("Wiki Document", space.root_group, ["lft", "rgt"])
		return frappe.get_all(
			"Wiki Document",
			fields=["name", "title", "source_path", "is_group", "doc_key", "parent_wiki_document"],
			filters=[["lft", ">=", root_lft], ["rgt", "<=", root_rgt]],
			order_by="lft asc",
		)

	def test_first_sync_builds_tree_and_stamps_source_path(self):
		space = _make_synced_space()
		repo = _FakeRepo(
			{
				"docs/intro.md": "# Intro\nbody",
				"docs/guides/setup.md": "# Setup\nbody",
			}
		)
		repo.install(self)
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")

		sync_space(space.name)

		docs = self._tree(space)
		paths = {d.source_path for d in docs if d.source_path}
		self.assertIn("docs/intro.md", paths)
		self.assertIn("docs/guides/setup.md", paths)
		self.assertIn("docs/guides", paths)  # folder group

		setup = next(d for d in docs if d.source_path == "docs/guides/setup.md")
		guides = next(d for d in docs if d.source_path == "docs/guides")
		self.assertEqual(setup.parent_wiki_document, guides.name)

		space.reload()
		self.assertEqual(space.last_sync_status, "Success")
		self.assertEqual(space.last_synced_commit_sha, "sha1")

	def test_source_path_and_doc_key_stable_across_resync(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		repo = _FakeRepo({"docs/intro.md": "# Intro\nv1"}, head_sha="sha1")
		repo.install(self)
		sync_space(space.name)

		before = next(d for d in self._tree(space) if d.source_path == "docs/intro.md")

		# New commit, same file path, edited content.
		repo.files["docs/intro.md"] = "# Intro\nv2 edited"
		repo.head_sha = "sha2"
		repo.install(self)
		sync_space(space.name)

		after = next(d for d in self._tree(space) if d.source_path == "docs/intro.md")
		self.assertEqual(before.name, after.name)
		self.assertEqual(before.doc_key, after.doc_key)
		content = frappe.db.get_value("Wiki Document", after.name, "content")
		self.assertIn("v2 edited", content)

	def test_add_update_delete_and_path_change_across_syncs(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		repo = _FakeRepo(
			{
				"docs/a.md": "# A",
				"docs/b.md": "# B",
				"docs/old/c.md": "# C",
			},
			head_sha="sha1",
		)
		repo.install(self)
		sync_space(space.name)

		a_before = next(d for d in self._tree(space) if d.source_path == "docs/a.md")

		# Add d.md, delete b.md, and relocate c.md (old/ → new/). Identity is keyed
		# on source_path, so a path change is a delete+add, not a tree move.
		repo.files = {
			"docs/a.md": "# A updated",
			"docs/d.md": "# D",
			"docs/new/c.md": "# C",
		}
		repo.head_sha = "sha2"
		repo.install(self)
		sync_space(space.name)

		docs = self._tree(space)
		paths = {d.source_path for d in docs if d.source_path}
		self.assertIn("docs/d.md", paths)
		self.assertNotIn("docs/b.md", paths)
		self.assertNotIn("docs/old/c.md", paths)
		self.assertNotIn("docs/old", paths)  # emptied folder group pruned
		self.assertIn("docs/new/c.md", paths)

		# Unchanged-path file keeps its identity; its content still updates.
		a_after = next(d for d in docs if d.source_path == "docs/a.md")
		self.assertEqual(a_before.doc_key, a_after.doc_key)
		self.assertEqual(a_before.name, a_after.name)
		self.assertIn("A updated", frappe.db.get_value("Wiki Document", a_after.name, "content"))

	def test_noop_sync_when_head_sha_unchanged(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		repo = _FakeRepo({"docs/intro.md": "# Intro"}, head_sha="sha1")
		repo.install(self)
		sync_space(space.name)

		revisions_before = frappe.db.count("Wiki Revision", {"wiki_space": space.name})

		# Same head SHA → engine must short-circuit before touching the tree.
		called = {"tree": False}
		original_tree = git_sync._fetch_tree

		def _tracking_tree(*args, **kwargs):
			called["tree"] = True
			return original_tree(*args, **kwargs)

		git_sync._fetch_tree = _tracking_tree
		sync_space(space.name)

		self.assertFalse(called["tree"], "tree should not be fetched on a no-op sync")
		revisions_after = frappe.db.count("Wiki Revision", {"wiki_space": space.name})
		self.assertEqual(revisions_before, revisions_after)


class TestGitSyncSpaceControls(FrappeTestCase):
	def tearDown(self):
		frappe.db.rollback()

	def test_git_synced_is_immutable_after_insert(self):
		space = _make_synced_space()
		space.reload()
		space.git_synced = 0
		self.assertRaises(frappe.ValidationError, space.save)

	def test_sync_now_rejects_non_synced_space(self):
		space = frappe.new_doc("Wiki Space")
		space.space_name = "Plain"
		space.route = f"plain-{frappe.generate_hash(length=6)}"
		space.insert()
		self.assertRaises(frappe.ValidationError, space.sync_now)
