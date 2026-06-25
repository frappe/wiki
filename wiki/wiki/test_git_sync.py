# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import hashlib
import json

import frappe
from frappe.tests.utils import FrappeTestCase

from wiki.wiki import git_sync
from wiki.wiki.git_sync import (
	build_nodes,
	build_nodes_from_config,
	load_wiki_config,
	strip_front_matter,
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

	@staticmethod
	def _blob_sha(path):
		# Slash-free hex, mirroring real GitHub's 40-char blob SHA. (A "blob:{path}"
		# sha would carry "/" that Frappe strips from File names, masking the
		# per-SHA idempotency check.) Stateless so reassigning `files` stays valid.
		return "blob" + hashlib.sha1(path.encode()).hexdigest()

	def _path_for(self, sha):
		return next(p for p in self.files if self._blob_sha(p) == sha)

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
			entries.append({"path": path, "type": "blob", "sha": self._blob_sha(path)})
		return entries

	def blob(self, sha):
		val = self.files[self._path_for(sha)]
		return val.decode() if isinstance(val, bytes) else val

	def blob_bytes(self, sha):
		val = self.files[self._path_for(sha)]
		return val if isinstance(val, bytes) else val.encode()

	def install(self, monkeypatch_target):
		git_sync._fetch_head_sha = lambda repo, branch, token=None: self.head_sha
		git_sync._fetch_tree = lambda repo, ref, token=None: self.tree()
		git_sync._fetch_blob = lambda repo, sha, token=None: self.blob(sha)
		git_sync._fetch_blob_bytes = lambda repo, sha, token=None: self.blob_bytes(sha)


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

	def test_build_nodes_ignores_dot_directories(self):
		# A whole-repo scan (no docs_subdir) must skip .github plumbing such as
		# issue templates and only surface real docs.
		files = {
			"intro.md": "# Intro",
			".github/ISSUE_TEMPLATE/bug_report.md": "# Bug",
			".github/PULL_REQUEST_TEMPLATE.md": "# PR",
		}
		repo = _FakeRepo(files)
		repo.install(self)
		nodes, _, _ = build_nodes("acme/docs", repo.tree(), "")
		paths = {n["source_path"] for n in nodes}
		self.assertIn("intro.md", paths)
		self.assertFalse(any(".github" in (p or "") for p in paths))

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
	"""`.wiki.json` (inside the docs folder) drives hierarchy, order, and titles."""

	def _repo_with_config(self, config):
		# The config lives *inside* the docs folder; its sidebar paths are relative
		# to that folder (no `docs_dir` key — the space already supplies it).
		files = {
			"docs/.wiki.json": json.dumps(config),
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
		self.assertIsNone(load_wiki_config("acme/docs", repo.tree(), "docs"))

	def test_load_wiki_config_parses_file_in_docs_folder(self):
		config = {"sidebar": [{"Intro": "intro.md"}]}
		repo = self._repo_with_config(config)
		self.assertEqual(load_wiki_config("acme/docs", repo.tree(), "docs"), config)

	def test_load_wiki_config_at_repo_root_when_no_docs_folder(self):
		# A blank docs folder means the repo root is the wiki root → config there.
		config = {"sidebar": [{"Intro": "intro.md"}]}
		repo = _FakeRepo({".wiki.json": json.dumps(config), "intro.md": "# Intro"})
		repo.install(self)
		self.assertEqual(load_wiki_config("acme/docs", repo.tree(), ""), config)

	def test_load_wiki_config_raises_on_malformed_json(self):
		repo = _FakeRepo({"docs/.wiki.json": "{not json"})
		repo.install(self)
		self.assertRaises(frappe.ValidationError, load_wiki_config, "acme/docs", repo.tree(), "docs")

	def test_config_drives_order_titles_and_nesting(self):
		config = {
			"sidebar": [
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
		# Titles come from the sidebar, NOT the files' H1.
		self.assertEqual(by_path["docs/intro.md"]["title"], "Intro")
		self.assertEqual(by_path["docs/guides/setup.md"]["title"], "Setup")
		self.assertEqual(by_path["docs/guides/deep.md"]["title"], "Deep Dive")

		# "Guides" is a group with a synthetic, file-less identity.
		guides = next(n for n in nodes if n["is_group"])
		self.assertEqual(guides["title"], "Guides")
		self.assertEqual(guides["dir"], "Guides")
		# Children nest under the group's dir key.
		self.assertEqual(by_path["docs/guides/setup.md"]["parent_dir"], "Guides")

		# seg is a zero-padded counter in sidebar order; the apply step's
		# alphabetical sibling sort then reproduces document order.
		self.assertLess(by_path["docs/intro.md"]["seg"], guides["seg"])
		self.assertLess(by_path["docs/guides/setup.md"]["seg"], by_path["docs/guides/deep.md"]["seg"])

	def test_config_root_index_is_a_landing_leaf(self):
		# A root-level README/index stays a normal leaf (so it shows in the sidebar)
		# but is flagged to route at the space root rather than /<space>/index.
		config = {"sidebar": [{"Home": "index.md"}, {"Intro": "intro.md"}]}
		files = {
			"docs/.wiki.json": json.dumps(config),
			"docs/index.md": "# Documentation Home\nwelcome",
			"docs/intro.md": "# Intro\nbody",
		}
		repo = _FakeRepo(files)
		repo.install(self)
		nodes, root_content, _ = build_nodes_from_config("acme/docs", repo.tree(), config, docs_subdir="docs")
		self.assertIsNone(root_content)
		by_path = {n["source_path"]: n for n in nodes}
		home = by_path["docs/index.md"]
		self.assertFalse(home["is_group"])
		self.assertTrue(home["landing"])
		self.assertFalse(by_path["docs/intro.md"].get("landing"))

	def test_config_skips_missing_files(self):
		config = {"sidebar": [{"Ghost": "nope.md"}, {"Intro": "intro.md"}]}
		repo = self._repo_with_config(config)
		nodes, _, _ = build_nodes_from_config("acme/docs", repo.tree(), config, docs_subdir="docs")
		paths = {n["source_path"] for n in nodes}
		self.assertNotIn("docs/nope.md", paths)
		self.assertIn("docs/intro.md", paths)

	def test_config_paths_resolve_under_docs_folder(self):
		config = {"sidebar": [{"Intro": "intro.md"}]}
		repo = self._repo_with_config(config)
		nodes, _, _ = build_nodes_from_config("acme/docs", repo.tree(), config, docs_subdir="docs")
		self.assertEqual(nodes[0]["source_path"], "docs/intro.md")

	# --- Starlight-shaped sidebar: bare paths, {label,items}, autogenerate ---

	def test_bare_path_leaf_infers_title(self):
		# A bare string entry is a leaf whose title is inferred from its H1.
		config = {"sidebar": ["intro.md", "guides/setup.md"]}
		repo = self._repo_with_config(config)
		nodes, _, _ = build_nodes_from_config("acme/docs", repo.tree(), config, docs_subdir="docs")
		by_path = {n["source_path"]: n for n in nodes}
		self.assertEqual(by_path["docs/intro.md"]["title"], "Heading In File")
		self.assertEqual(by_path["docs/guides/setup.md"]["title"], "Setup In File")

	def test_explicit_label_and_items_shapes(self):
		# {label, page} leaf (label authoritative) and {label, items} group.
		config = {
			"sidebar": [
				{"label": "Intro", "page": "intro.md"},
				{"label": "Guides", "items": ["guides/setup.md"]},
			]
		}
		repo = self._repo_with_config(config)
		nodes, _, _ = build_nodes_from_config("acme/docs", repo.tree(), config, docs_subdir="docs")
		by_path = {n["source_path"]: n for n in nodes}
		self.assertEqual(by_path["docs/intro.md"]["title"], "Intro")  # label wins
		group = next(n for n in nodes if n["is_group"])
		self.assertEqual(group["title"], "Guides")
		# The bare child of the group infers its own title from H1.
		setup = by_path["docs/guides/setup.md"]
		self.assertEqual(setup["parent_dir"], group["dir"])
		self.assertEqual(setup["title"], "Setup In File")

	def test_autogenerate_labeled_group(self):
		# autogenerate fills a named group from a folder via the inference engine.
		config = {"sidebar": [{"label": "Reference", "autogenerate": {"directory": "guides"}}]}
		repo = self._repo_with_config(config)
		nodes, _, _ = build_nodes_from_config("acme/docs", repo.tree(), config, docs_subdir="docs")
		group = next(n for n in nodes if n["is_group"] and n["title"] == "Reference")
		children = {n["source_path"] for n in nodes if n["parent_dir"] == group["dir"]}
		self.assertEqual(children, {"docs/guides/setup.md", "docs/guides/deep.md"})

	def test_autogenerate_inline_after_pinned_entry(self):
		# A pinned leaf, then an unlabeled autogenerate splicing the folder inline.
		config = {"sidebar": ["intro.md", {"autogenerate": {"directory": "guides"}}]}
		repo = self._repo_with_config(config)
		nodes, _, _ = build_nodes_from_config("acme/docs", repo.tree(), config, docs_subdir="docs")
		by_path = {n["source_path"]: n for n in nodes}
		# guides files splice at the root (no wrapping group) …
		self.assertEqual(by_path["docs/guides/setup.md"]["parent_dir"], "")
		# … and the pinned intro sorts before them.
		self.assertLess(by_path["docs/intro.md"]["seg"], by_path["docs/guides/setup.md"]["seg"])
		self.assertLess(by_path["docs/intro.md"]["seg"], by_path["docs/guides/deep.md"]["seg"])


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

	def test_deeply_nested_long_route_syncs(self):
		# A deep repo tree builds a route from the full ancestor chain that
		# exceeds the default 140-char Data limit; the route field is widened
		# so the sync doesn't blow up with CharacterLengthExceededError.
		space = _make_synced_space()
		deep_path = (
			"sop/obstetrics-gynaecology/obstetrics-gynaecology-reference/"
			"responsibilities-and-job-description/"
			"prophylactic-antibiotics-and-anticoagulation.md"
		)
		repo = _FakeRepo({deep_path: "# Prophylactic Antibiotics And Anticoagulation\nbody"})
		repo.install(self)

		sync_space(space.name)

		space.reload()
		self.assertEqual(space.last_sync_status, "Success", space.last_sync_error)
		leaf = next(d for d in self._tree(space) if d.source_path == deep_path)
		route = frappe.db.get_value("Wiki Document", leaf.name, "route")
		self.assertGreater(len(route), 140)  # would have truncated/thrown before the fix

	def test_colliding_slugs_get_unique_routes(self):
		# Two files in one folder that slugify identically (and share an H1) must
		# not collide on route — path-based slug + numeric-suffix dedup keep the
		# whole sync from failing on validate_unique_route_for_leaves.
		space = _make_synced_space()
		repo = _FakeRepo(
			{
				"api/foo-bar.md": "# Controls\na",
				"api/foo_bar.md": "# Controls\nb",  # underscore → same slug as above
			}
		)
		repo.install(self)
		sync_space(space.name)

		space.reload()
		self.assertEqual(space.last_sync_status, "Success", space.last_sync_error)
		leaves = [d for d in self._tree(space) if not d.is_group and d.source_path]
		routes = [frappe.db.get_value("Wiki Document", d.name, "route") for d in leaves]
		self.assertEqual(len(routes), 2)
		self.assertEqual(len(set(routes)), 2)  # unique despite identical slugs

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

	def test_root_readme_routes_at_space_route(self):
		# A docs-root README stays a normal sidebar page but is served at the space
		# route (/<space>/), not /<space>/index.
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		config = {"sidebar": [{"Home": "README.md"}, {"Intro": "intro.md"}]}
		repo = _FakeRepo(
			{
				"docs/.wiki.json": json.dumps(config),
				"docs/README.md": "# Home\nwelcome",
				"docs/intro.md": "# Intro",
			}
		)
		repo.install(self)
		sync_space(space.name)

		docs = self._tree(space)
		home = next(d for d in docs if d.source_path == "docs/README.md")
		self.assertFalse(home.is_group)  # still a page — shows in the sidebar
		self.assertEqual(home.parent_wiki_document, space.root_group)
		# served at /<space>/, not /<space>/readme
		self.assertEqual(frappe.db.get_value("Wiki Document", home.name, "route"), space.route)

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
		# Sidebar lists "zebra" before "apple" — inference would sort alphabetically,
		# so the live order proves the config (not the filename) wins.
		config = {
			"sidebar": [
				{"Zebra": "zebra.md"},
				{"Apple": "apple.md"},
				{"Guides": [{"Setup": "guides/setup.md"}]},
			],
		}
		repo = _FakeRepo(
			{
				"docs/.wiki.json": json.dumps(config),
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

		# Title comes from the sidebar, not the file H1.
		zebra = next(d for d in docs if d.source_path == "docs/zebra.md")
		self.assertEqual(zebra.title, "Zebra")
		# Leaf nests under the sidebar group.
		guides = next(d for d in docs if d.is_group and d.title == "Guides")
		setup = next(d for d in docs if d.source_path == "docs/guides/setup.md")
		self.assertEqual(setup.parent_wiki_document, guides.name)

	def test_sync_stores_loaded_config_on_space(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		config = {"sidebar": [{"Intro": "intro.md"}]}
		repo = _FakeRepo({"docs/.wiki.json": json.dumps(config), "docs/intro.md": "# Intro"})
		repo.install(self)
		sync_space(space.name)

		stored = frappe.db.get_value("Wiki Space", space.name, "wiki_config")
		self.assertEqual(json.loads(stored), config)

	def test_sync_clears_config_when_absent(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		frappe.db.set_value("Wiki Space", space.name, "wiki_config", '{"stale": true}')
		repo = _FakeRepo({"docs/intro.md": "# Intro"})  # no .wiki.json
		repo.install(self)
		sync_space(space.name)

		self.assertFalse(frappe.db.get_value("Wiki Space", space.name, "wiki_config"))

	def test_internal_page_links_rewritten_to_routes(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		repo = _FakeRepo(
			{
				"docs/home.md": (
					"# Home\n"
					"- [Install](getting-started/install.md)\n"
					"- [Anchor](getting-started/install.md#step-2)\n"
					"- [External](https://example.com)\n"
					"- [In-page](#section)\n"
					"- [Missing](nope.md)\n"
				),
				"docs/getting-started/install.md": "# Install",
			}
		)
		repo.install(self)
		sync_space(space.name)

		root_lft, root_rgt = frappe.db.get_value("Wiki Document", space.root_group, ["lft", "rgt"])

		def _doc(source_path, fields):
			return frappe.get_all(
				"Wiki Document",
				fields=fields,
				filters=[["source_path", "=", source_path], ["lft", ">=", root_lft], ["rgt", "<=", root_rgt]],
			)[0]

		install_route = _doc("docs/getting-started/install.md", ["route"]).route
		content = _doc("docs/home.md", ["content"]).content

		# Repo-relative .md links become absolute wiki routes (fragment preserved).
		self.assertIn(f"](/{install_route})", content)
		self.assertIn(f"](/{install_route}#step-2)", content)
		# External links, in-page anchors, and links to non-synced files are untouched.
		self.assertIn("](https://example.com)", content)
		self.assertIn("](#section)", content)
		self.assertIn("](nope.md)", content)
		# The raw ".md" target must not survive as a real internal link.
		self.assertNotIn("](getting-started/install.md)", content)

	def test_autogenerate_syncs_folder_into_group(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		config = {"sidebar": [{"label": "Reference", "autogenerate": {"directory": "api"}}]}
		repo = _FakeRepo(
			{
				"docs/.wiki.json": json.dumps(config),
				"docs/api/README.md": "# API Home\nlanding",
				"docs/api/auth.md": "# Auth",
				"docs/api/users.md": "# Users",
			}
		)
		repo.install(self)
		sync_space(space.name)

		docs = self._tree(space)
		group = next(d for d in docs if d.is_group and d.title == "Reference")
		# The folder's README becomes the group's landing (Edit-on-GitHub source).
		self.assertEqual(group.source_path, "docs/api/README.md")
		children = {d.source_path for d in docs if d.parent_wiki_document == group.name}
		self.assertEqual(children, {"docs/api/auth.md", "docs/api/users.md"})

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


class TestGitSyncLog(FrappeTestCase):
	"""Every sync run writes one observable Wiki Git Sync Log row with counts."""

	def tearDown(self):
		frappe.db.rollback()

	def _logs(self, space_name):
		return frappe.get_all(
			"Wiki Git Sync Log",
			filters={"wiki_space": space_name},
			fields=[
				"name",
				"status",
				"commit_sha",
				"started_at",
				"finished_at",
				"created_count",
				"updated_count",
				"deleted_count",
				"moved_count",
			],
			order_by="creation asc",
		)

	def test_first_sync_logs_success_with_created_counts(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		repo = _FakeRepo({"docs/intro.md": "# Intro", "docs/guides/setup.md": "# Setup"}, head_sha="sha1")
		repo.install(self)
		sync_space(space.name)

		logs = self._logs(space.name)
		self.assertEqual(len(logs), 1)
		log = logs[0]
		self.assertEqual(log.status, "Success")
		self.assertEqual(log.commit_sha, "sha1")
		self.assertIsNotNone(log.finished_at)
		# intro.md, the guides group, and guides/setup.md are all created.
		self.assertEqual(log.created_count, 3)
		self.assertEqual(log.deleted_count, 0)
		self.assertEqual(log.moved_count, 0)

	def test_noop_sync_logs_no_change(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		repo = _FakeRepo({"docs/intro.md": "# Intro"}, head_sha="sha1")
		repo.install(self)
		sync_space(space.name)
		sync_space(space.name)  # same head SHA → short-circuit

		logs = self._logs(space.name)
		self.assertEqual([log.status for log in logs], ["Success", "No Change"])
		self.assertEqual(logs[1].created_count, 0)
		self.assertEqual(logs[1].commit_sha, "sha1")

	def test_resync_logs_created_and_deleted_counts(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		repo = _FakeRepo({"docs/a.md": "# A", "docs/b.md": "# B"}, head_sha="sha1")
		repo.install(self)
		sync_space(space.name)

		# Add c.md, drop b.md, edit a.md.
		repo.files = {"docs/a.md": "# A edited", "docs/c.md": "# C"}
		repo.head_sha = "sha2"
		repo.install(self)
		sync_space(space.name)

		log = self._logs(space.name)[-1]
		self.assertEqual(log.status, "Success")
		self.assertEqual(log.created_count, 1)  # c.md
		self.assertEqual(log.deleted_count, 1)  # b.md
		self.assertEqual(log.updated_count, 1)  # a.md content edit

	def test_missing_repo_logs_error(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, {"repo_full_name": "", "branch": ""})
		sync_space(space.name)

		logs = self._logs(space.name)
		self.assertEqual(len(logs), 1)
		self.assertEqual(logs[0].status, "Error")


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

	def test_sync_now_requires_write_permission(self):
		"""A reader without write access can't trigger a sync (whitelisted doc
		methods only enforce read by default)."""
		space = _make_synced_space()

		email = f"git-sync-reader-{frappe.generate_hash(length=6)}@example.com"
		user = frappe.get_doc(
			{"doctype": "User", "email": email, "first_name": "Reader", "send_welcome_email": 0}
		).insert(ignore_permissions=True)

		frappe.set_user(user.name)
		try:
			self.assertRaises(frappe.PermissionError, space.sync_now)
		finally:
			frappe.set_user("Administrator")

	def test_space_deletion_cascades_content(self):
		"""Deleting a space tears down its documents, revisions and root group —
		without the on_trash cascade these links raise LinkExistsError."""
		space = _make_synced_space()
		leaf = frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": "Leaf",
				"route": f"{space.route}/leaf",
				"content": "# Leaf",
				"parent_wiki_document": space.root_group,
				"wiki_space": space.name,
			}
		).insert(ignore_permissions=True)
		frappe.get_doc(
			{
				"doctype": "Wiki Document",
				"title": "Nested",
				"route": f"{space.route}/leaf/nested",
				"content": "# Nested",
				"parent_wiki_document": leaf.name,
				"wiki_space": space.name,
			}
		).insert(ignore_permissions=True)

		space_name, root = space.name, space.root_group
		frappe.delete_doc("Wiki Space", space_name)  # no force: relies on on_trash

		self.assertFalse(frappe.db.exists("Wiki Space", space_name))
		self.assertFalse(frappe.db.exists("Wiki Document", root))
		self.assertEqual(frappe.get_all("Wiki Document", filters={"wiki_space": space_name}), [])
		self.assertEqual(frappe.get_all("Wiki Revision", filters={"wiki_space": space_name}), [])


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


# A minimal 1x1 valid PNG so PIL-backed WebP conversion has real bytes to open.
_PNG_1x1 = (
	b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
	b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00"
	b"\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


class TestGitSyncImages(FrappeTestCase):
	"""TB8a — repo-relative Markdown images are imported as Frappe Files and links rewritten."""

	def tearDown(self):
		frappe.db.rollback()

	def _set_webp(self, enabled):
		frappe.db.set_single_value("Wiki Settings", "auto_convert_images_to_webp", 1 if enabled else 0)

	def _files_for(self, space):
		return frappe.get_all(
			"File",
			filters={"attached_to_doctype": "Wiki Space", "attached_to_name": space.name},
			fields=["name", "file_name", "file_url"],
		)

	def test_relative_image_imported_and_link_rewritten(self):
		self._set_webp(False)
		space = _make_synced_space()
		repo = _FakeRepo(
			{
				"docs/guides/setup.md": "# Setup\n![logo](../img/logo.png)\nbody",
				"docs/img/logo.png": _PNG_1x1,
			}
		)
		repo.install(self)

		nodes, _, _ = build_nodes("acme/docs", repo.tree(), "docs", space=space)

		setup = next(n for n in nodes if n["source_path"] == "docs/guides/setup.md")
		self.assertNotIn("../img/logo.png", setup["content"])
		self.assertRegex(setup["content"], r"!\[logo\]\(/files/gitimg-[^)]+\)")

		files = self._files_for(space)
		self.assertEqual(len(files), 1)
		self.assertTrue(files[0].file_name.startswith("gitimg-"))

	def test_external_and_absolute_urls_untouched(self):
		self._set_webp(False)
		space = _make_synced_space()
		md = "# P\n![a](https://x.test/a.png) ![b](/files/already.png) ![c](data:image/png;base64,zz)"
		repo = _FakeRepo({"docs/p.md": md})
		repo.install(self)

		nodes, _, _ = build_nodes("acme/docs", repo.tree(), "docs", space=space)
		content = next(n for n in nodes if n["source_path"] == "docs/p.md")["content"]
		self.assertEqual(content, md)
		self.assertEqual(self._files_for(space), [])

	def test_missing_image_left_untouched(self):
		self._set_webp(False)
		space = _make_synced_space()
		repo = _FakeRepo({"docs/p.md": "# P\n![gone](./gone.png)"})
		repo.install(self)

		nodes, _, _ = build_nodes("acme/docs", repo.tree(), "docs", space=space)
		content = next(n for n in nodes if n["source_path"] == "docs/p.md")["content"]
		self.assertIn("./gone.png", content)
		self.assertEqual(self._files_for(space), [])

	def test_reimport_is_sha_idempotent(self):
		self._set_webp(False)
		space = _make_synced_space()
		repo = _FakeRepo({"docs/p.md": "# P\n![logo](img/logo.png)", "docs/img/logo.png": _PNG_1x1})
		repo.install(self)

		first = build_nodes("acme/docs", repo.tree(), "docs", space=space)[0]
		second = build_nodes("acme/docs", repo.tree(), "docs", space=space)[0]

		# Same image SHA → one File reused, identical rewritten URL (no content churn).
		self.assertEqual(len(self._files_for(space)), 1)
		c1 = next(n for n in first if n["source_path"] == "docs/p.md")["content"]
		c2 = next(n for n in second if n["source_path"] == "docs/p.md")["content"]
		self.assertEqual(c1, c2)

	def test_webp_conversion_when_enabled(self):
		self._set_webp(True)
		space = _make_synced_space()
		repo = _FakeRepo({"docs/p.md": "# P\n![logo](img/logo.png)", "docs/img/logo.png": _PNG_1x1})
		repo.install(self)

		nodes, _, _ = build_nodes("acme/docs", repo.tree(), "docs", space=space)
		content = next(n for n in nodes if n["source_path"] == "docs/p.md")["content"]
		self.assertRegex(content, r"/files/gitimg-[^)]+\.webp")

	def test_no_webp_keeps_original_extension(self):
		self._set_webp(False)
		space = _make_synced_space()
		repo = _FakeRepo({"docs/p.md": "# P\n![logo](img/logo.png)", "docs/img/logo.png": _PNG_1x1})
		repo.install(self)

		nodes, _, _ = build_nodes("acme/docs", repo.tree(), "docs", space=space)
		content = next(n for n in nodes if n["source_path"] == "docs/p.md")["content"]
		self.assertRegex(content, r"/files/gitimg-[^)]+\.png")
		self.assertNotIn(".webp", content)


class TestGitSyncFrontMatter(FrappeTestCase):
	"""TB9 — leading YAML front matter is stripped before render; its `title` is used."""

	def tearDown(self):
		frappe.db.rollback()

	def _page(self, nodes, path):
		return next(n for n in nodes if n["source_path"] == path)

	def test_strip_front_matter_returns_body_and_meta(self):
		body, meta = strip_front_matter("---\ntitle: Hello\nsidebar_position: 2\n---\n# Heading\nbody")
		self.assertEqual(meta["title"], "Hello")
		self.assertEqual(meta["sidebar_position"], 2)
		self.assertEqual(body, "# Heading\nbody")

	def test_strip_handles_crlf_and_bom(self):
		body, meta = strip_front_matter("﻿---\r\ntitle: Hi\r\n---\r\nbody")
		self.assertEqual(meta["title"], "Hi")
		self.assertEqual(body, "body")

	def test_no_front_matter_left_unchanged(self):
		raw = "# Heading\njust content\n"
		self.assertEqual(strip_front_matter(raw), (raw, {}))

	def test_malformed_yaml_left_intact(self):
		# Unparseable YAML must not crash or eat content — return it verbatim.
		raw = "---\ntitle: : : oops\n\t- bad\n---\nbody"
		body, meta = strip_front_matter(raw)
		self.assertEqual(body, raw)
		self.assertEqual(meta, {})

	def test_leading_thematic_break_not_front_matter(self):
		# A leading "---" whose block parses to a non-mapping (plain string) is a
		# thematic break, not front matter → left intact.
		raw = "---\njust a paragraph\n---\nmore"
		body, meta = strip_front_matter(raw)
		self.assertEqual(body, raw)
		self.assertEqual(meta, {})

	def test_mid_body_thematic_break_untouched(self):
		body, _ = strip_front_matter("---\ntitle: T\n---\nintro\n\n---\n\noutro")
		self.assertEqual(body, "intro\n\n---\n\noutro")

	def test_build_nodes_strips_block_and_uses_title(self):
		repo = _FakeRepo({"docs/intro.md": "---\ntitle: Getting Started\n---\nbody only"})
		repo.install(self)
		nodes, _, _ = build_nodes("acme/docs", repo.tree(), "docs")
		node = self._page(nodes, "docs/intro.md")
		# Title comes from front matter; the block never reaches the stored content.
		self.assertEqual(node["title"], "Getting Started")
		self.assertEqual(node["content"], "body only")
		self.assertNotIn("---", node["content"])
		self.assertNotIn("title:", node["content"])

	def test_h1_fallback_when_no_front_matter_title(self):
		# Front matter present but no `title` key → fall back to the H1.
		repo = _FakeRepo({"docs/intro.md": "---\nsidebar_position: 1\n---\n# Real Heading\nbody"})
		repo.install(self)
		nodes, _, _ = build_nodes("acme/docs", repo.tree(), "docs")
		node = self._page(nodes, "docs/intro.md")
		self.assertEqual(node["title"], "Real Heading")
		self.assertEqual(node["content"], "# Real Heading\nbody")

	def test_humanized_filename_fallback(self):
		# Front matter title non-scalar (list) and no H1 → humanized filename.
		repo = _FakeRepo({"docs/getting-started.md": "---\ntitle:\n  - a\n  - b\n---\nbody"})
		repo.install(self)
		nodes, _, _ = build_nodes("acme/docs", repo.tree(), "docs")
		node = self._page(nodes, "docs/getting-started.md")
		self.assertEqual(node["title"], "Getting Started")

	def test_config_sidebar_title_wins_but_body_stripped(self):
		config = {"sidebar": [{"Sidebar Title": "intro.md"}]}
		files = {
			"docs/.wiki.json": json.dumps(config),
			"docs/intro.md": "---\ntitle: FM Title\n---\n# H1\nbody",
		}
		repo = _FakeRepo(files)
		repo.install(self)
		nodes, _, _ = build_nodes_from_config("acme/docs", repo.tree(), config, docs_subdir="docs")
		node = self._page(nodes, "docs/intro.md")
		self.assertEqual(node["title"], "Sidebar Title")  # sidebar is authoritative
		self.assertEqual(node["content"], "# H1\nbody")  # but body is still stripped

	def test_front_matter_title_flows_to_live_document(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		repo = _FakeRepo({"docs/intro.md": "---\ntitle: Getting Started\n---\njust body"})
		repo.install(self)
		sync_space(space.name)

		root_lft, root_rgt = frappe.db.get_value("Wiki Document", space.root_group, ["lft", "rgt"])
		doc = frappe.get_all(
			"Wiki Document",
			fields=["title", "content"],
			filters=[["source_path", "=", "docs/intro.md"], ["lft", ">=", root_lft], ["rgt", "<=", root_rgt]],
		)[0]
		self.assertEqual(doc.title, "Getting Started")
		self.assertNotIn("---", doc.content)

	def test_front_matter_is_published_flag(self):
		# `published: false` (and `draft: true`) mark a node unpublished; a node
		# with no publish key — or none at all — stays published.
		files = {
			"docs/public.md": "# Public",
			"docs/hidden.md": "---\npublished: false\n---\n# Hidden",
			"docs/draft.md": "---\ndraft: true\n---\n# Draft",
			"docs/explicit.md": "---\nis_published: true\n---\n# Explicit",
		}
		repo = _FakeRepo(files)
		repo.install(self)
		nodes, _, _ = build_nodes("acme/docs", repo.tree(), "docs")
		by_path = {n["source_path"]: n for n in nodes}
		self.assertEqual(by_path["docs/public.md"]["is_published"], 1)
		self.assertEqual(by_path["docs/hidden.md"]["is_published"], 0)
		self.assertEqual(by_path["docs/draft.md"]["is_published"], 0)
		self.assertEqual(by_path["docs/explicit.md"]["is_published"], 1)

	def test_front_matter_unpublished_flows_to_live_document(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		repo = _FakeRepo({"docs/hidden.md": "---\npublished: false\n---\n# Hidden\nbody"})
		repo.install(self)
		sync_space(space.name)

		root_lft, root_rgt = frappe.db.get_value("Wiki Document", space.root_group, ["lft", "rgt"])
		doc = frappe.get_all(
			"Wiki Document",
			fields=["is_published"],
			filters=[
				["source_path", "=", "docs/hidden.md"],
				["lft", ">=", root_lft],
				["rgt", "<=", root_rgt],
			],
		)[0]
		self.assertEqual(doc.is_published, 0)

	def test_front_matter_slug_overrides_filename(self):
		# A front-matter `slug` sets the node slug (→ route) instead of the filename.
		repo = _FakeRepo({"docs/getting-started.md": "---\nslug: intro\n---\n# Getting Started"})
		repo.install(self)
		nodes, _, _ = build_nodes("acme/docs", repo.tree(), "docs")
		self.assertEqual(self._page(nodes, "docs/getting-started.md")["slug"], "intro")

	def test_front_matter_slug_flows_to_route(self):
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		repo = _FakeRepo({"docs/getting-started.md": "---\nslug: intro\n---\n# Getting Started"})
		repo.install(self)
		sync_space(space.name)

		root_lft, root_rgt = frappe.db.get_value("Wiki Document", space.root_group, ["lft", "rgt"])
		doc = frappe.get_all(
			"Wiki Document",
			fields=["route"],
			filters=[
				["source_path", "=", "docs/getting-started.md"],
				["lft", ">=", root_lft],
				["rgt", "<=", root_rgt],
			],
		)[0]
		self.assertTrue(doc.route.endswith("/intro"), doc.route)

	def test_front_matter_ordering_sorts_siblings(self):
		# Lower `sidebar_position` sorts earlier; a file with no order falls back to
		# alphabetical *after* the explicitly-ordered ones.
		space = _make_synced_space()
		frappe.db.set_value("Wiki Space", space.name, "docs_subdir", "docs")
		repo = _FakeRepo(
			{
				"docs/a.md": "---\nsidebar_position: 2\n---\n# A",
				"docs/b.md": "---\nsidebar_position: 1\n---\n# B",
				"docs/c.md": "# C",
			}
		)
		repo.install(self)
		sync_space(space.name)

		root_lft, root_rgt = frappe.db.get_value("Wiki Document", space.root_group, ["lft", "rgt"])
		docs = frappe.get_all(
			"Wiki Document",
			fields=["source_path", "sort_order"],
			filters=[["lft", ">", root_lft], ["rgt", "<", root_rgt]],
			order_by="sort_order asc",
		)
		self.assertEqual([d.source_path for d in docs], ["docs/b.md", "docs/a.md", "docs/c.md"])
