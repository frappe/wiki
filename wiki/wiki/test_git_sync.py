# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import json

import frappe
from frappe.tests.utils import FrappeTestCase

from wiki.wiki import git_sync
from wiki.wiki.git_sync import (
	build_nodes,
	build_nodes_from_config,
	load_wiki_config,
	sync_space,
)


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
		# Folder "guides" is a group whose content comes from its README landing;
		# its source_path points at that README so "Edit on GitHub" (TB2) opens an
		# editable file rather than a directory.
		guides = by_path["docs/guides/README.md"]
		self.assertEqual(guides["is_group"], 1)
		self.assertEqual(guides["dir"], "guides")
		self.assertEqual(guides["title"], "Guides")
		self.assertIn("landing", guides["content"])
		# README is folded into the group, not emitted as a standalone leaf page.
		self.assertFalse(
			any(n["source_path"] == "docs/guides/README.md" and not n["is_group"] for n in nodes)
		)
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


class TestGitSyncConfig(FrappeTestCase):
	"""`.wiki.json` drives hierarchy, order, and titles instead of inference."""

	def _repo_with_config(self, config):
		files = {
			git_sync.WIKI_CONFIG_PATH: json.dumps(config),
			"docs/intro.md": "# Heading In File\nbody",
			"docs/guides/setup.md": "# Setup In File\nsteps",
			"docs/guides/deep.md": "# Deep\nstuff",
		}
		repo = _FakeRepo(files)
		repo.install(self)
		return repo

	def test_load_wiki_config_absent_returns_none(self):
		repo = _FakeRepo({"docs/intro.md": "# Intro"})
		repo.install(self)
		self.assertIsNone(load_wiki_config("acme/docs", repo.tree()))

	def test_load_wiki_config_parses_root_file(self):
		config = {"docs_dir": "docs", "nav": [{"Intro": "intro.md"}]}
		repo = self._repo_with_config(config)
		self.assertEqual(load_wiki_config("acme/docs", repo.tree()), config)

	def test_load_wiki_config_raises_on_malformed_json(self):
		repo = _FakeRepo({git_sync.WIKI_CONFIG_PATH: "{not json"})
		repo.install(self)
		self.assertRaises(frappe.ValidationError, load_wiki_config, "acme/docs", repo.tree())

	def test_config_drives_order_titles_and_nesting(self):
		config = {
			"docs_dir": "docs",
			"nav": [
				{"Intro": "intro.md"},
				{"Guides": [{"Setup": "guides/setup.md"}, {"Deep Dive": "guides/deep.md"}]},
			],
		}
		repo = self._repo_with_config(config)
		nodes, root_content, root_landing = build_nodes_from_config(
			"acme/docs", repo.tree(), config, docs_subdir="docs"
		)
		self.assertIsNone(root_content)
		self.assertIsNone(root_landing)

		by_path = {n["source_path"]: n for n in nodes}
		# Titles come from nav, NOT the files' H1.
		self.assertEqual(by_path["docs/intro.md"]["title"], "Intro")
		self.assertEqual(by_path["docs/guides/setup.md"]["title"], "Setup")
		self.assertEqual(by_path["docs/guides/deep.md"]["title"], "Deep Dive")

		# "Guides" is a group with a synthetic, file-less identity.
		guides = next(n for n in nodes if n["is_group"])
		self.assertEqual(guides["title"], "Guides")
		self.assertEqual(guides["dir"], "Guides")
		# Children nest under the group's dir key.
		self.assertEqual(by_path["docs/guides/setup.md"]["parent_dir"], "Guides")

		# seg is a zero-padded counter in nav order; the apply step's alphabetical
		# sibling sort then reproduces document order.
		self.assertLess(by_path["docs/intro.md"]["seg"], guides["seg"])
		self.assertLess(by_path["docs/guides/setup.md"]["seg"], by_path["docs/guides/deep.md"]["seg"])

	def test_config_skips_missing_files(self):
		config = {"docs_dir": "docs", "nav": [{"Ghost": "nope.md"}, {"Intro": "intro.md"}]}
		repo = self._repo_with_config(config)
		nodes, _, _ = build_nodes_from_config("acme/docs", repo.tree(), config, docs_subdir="docs")
		paths = {n["source_path"] for n in nodes}
		self.assertNotIn("docs/nope.md", paths)
		self.assertIn("docs/intro.md", paths)

	def test_config_docs_dir_overrides_space_subdir(self):
		config = {"docs_dir": "docs", "nav": [{"Intro": "intro.md"}]}
		repo = self._repo_with_config(config)
		nodes, _, _ = build_nodes_from_config("acme/docs", repo.tree(), config, docs_subdir="ignored")
		self.assertEqual(nodes[0]["source_path"], "docs/intro.md")


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

	def test_group_landing_source_path_points_at_readme(self):
		# A group with a README landing stamps the README path as its source_path,
		# so the frontend can build an "Edit on GitHub" link to the editable file.
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		repo = _FakeRepo(
			{
				"docs/guides/README.md": "# Guides\nlanding",
				"docs/guides/setup.md": "# Setup",
			}
		)
		repo.install(self)
		sync_space(space.name)

		docs = self._tree(space)
		guides = next(d for d in docs if d.is_group and d.title == "Guides")
		self.assertEqual(guides.source_path, "docs/guides/README.md")
		# The leaf keeps its own file path and nests under the group.
		setup = next(d for d in docs if d.source_path == "docs/guides/setup.md")
		self.assertEqual(setup.parent_wiki_document, guides.name)

	def test_private_repo_mints_installation_token_from_id(self):
		# With a github_installation_id and no explicit token, the engine mints a
		# short-lived installation token and threads it through the GitHub calls.
		space = _make_synced_space()
		frappe.db.set_value(
			"Wiki Space", space.name, {"docs_subdir": "docs", "github_installation_id": "777"}
		)
		repo = _FakeRepo({"docs/intro.md": "# Intro\nbody"})
		repo.install(self)

		from wiki.api import github as github_api

		minted_for = {}

		def _fake_minter(installation_id):
			minted_for["id"] = installation_id
			return "ghs_minted"

		orig_minter = github_api.installation_access_token
		github_api.installation_access_token = _fake_minter
		self.addCleanup(setattr, github_api, "installation_access_token", orig_minter)

		captured = {}
		git_sync._fetch_head_sha = lambda r, b, token=None: (
			captured.__setitem__("token", token),
			repo.head_sha,
		)[1]

		sync_space(space.name)

		self.assertEqual(minted_for["id"], "777")
		self.assertEqual(captured["token"], "ghs_minted")
		space.reload()
		self.assertEqual(space.last_sync_status, "Success")

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

	def test_wiki_config_drives_live_tree_order_and_titles(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		# Nav lists "zebra" before "apple" — inference would sort alphabetically,
		# so the live order proves the config (not the filename) wins.
		config = {
			"docs_dir": "docs",
			"nav": [
				{"Zebra": "zebra.md"},
				{"Apple": "apple.md"},
				{"Guides": [{"Setup": "guides/setup.md"}]},
			],
		}
		repo = _FakeRepo(
			{
				git_sync.WIKI_CONFIG_PATH: json.dumps(config),
				"docs/zebra.md": "# Ignored H1",
				"docs/apple.md": "# Also Ignored",
				"docs/guides/setup.md": "# Setup",
			}
		)
		repo.install(self)
		sync_space(space.name)

		docs = self._tree(space)
		top_level = [d for d in docs if d.parent_wiki_document == space.root_group]
		top_level.sort(key=lambda d: frappe.db.get_value("Wiki Document", d.name, "sort_order") or 0)
		self.assertEqual([d.title for d in top_level], ["Zebra", "Apple", "Guides"])

		# Title comes from nav, not the file H1.
		zebra = next(d for d in docs if d.source_path == "docs/zebra.md")
		self.assertEqual(zebra.title, "Zebra")
		# Leaf nests under the nav group.
		guides = next(d for d in docs if d.is_group and d.title == "Guides")
		setup = next(d for d in docs if d.source_path == "docs/guides/setup.md")
		self.assertEqual(setup.parent_wiki_document, guides.name)

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


class TestGitSyncReadOnly(FrappeTestCase):
	"""A git-synced space is read-only: every content-mutation entry point is blocked,
	while the sync engine (in_apply_merge_revision) still gets through."""

	def tearDown(self):
		frappe.flags.in_apply_merge_revision = False
		frappe.db.rollback()

	def _plain_space(self):
		space = frappe.new_doc("Wiki Space")
		space.space_name = "Plain"
		space.route = f"plain-{frappe.generate_hash(length=6)}"
		space.insert()
		return space

	def test_assert_space_writable_blocks_synced_space(self):
		from wiki.permissions import assert_space_writable

		synced = _make_synced_space()
		self.assertRaises(frappe.PermissionError, assert_space_writable, synced.name)

		# The sync engine itself is exempt.
		frappe.flags.in_apply_merge_revision = True
		assert_space_writable(synced.name)  # must not raise

	def test_assert_space_writable_allows_plain_space(self):
		from wiki.permissions import assert_space_writable

		assert_space_writable(self._plain_space().name)  # must not raise

	def test_create_change_request_blocked_on_synced_space(self):
		from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
			create_change_request,
		)

		synced = _make_synced_space()
		self.assertRaises(frappe.PermissionError, create_change_request, synced.name, "Nope")

	def test_get_or_create_draft_blocked_on_synced_space(self):
		from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
			get_or_create_draft_change_request,
		)

		synced = _make_synced_space()
		self.assertRaises(frappe.PermissionError, get_or_create_draft_change_request, synced.name)

	def test_reorder_blocked_on_synced_space(self):
		from wiki.api.wiki_space import reorder_wiki_documents

		synced = _make_synced_space()
		self.assertRaises(
			frappe.PermissionError,
			reorder_wiki_documents,
			synced.root_group,
			None,
			0,
			"[]",
		)

	def test_document_write_permission_denied_then_allowed_under_merge(self):
		from wiki.permissions import wiki_document_has_permission

		synced = _make_synced_space()
		doc = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": "Page",
				"route": f"{synced.route}/page",
				"content": "# Page",
				"parent_wiki_document": synced.root_group,
				"wiki_space": synced.name,
			}
		).insert(ignore_permissions=True)

		self.assertTrue(wiki_document_has_permission(doc, "read", "Administrator"))
		self.assertFalse(wiki_document_has_permission(doc, "write", "Administrator"))

		# The sync engine writes documents under in_apply_merge_revision.
		frappe.flags.in_apply_merge_revision = True
		self.assertTrue(wiki_document_has_permission(doc, "write", "Administrator"))
