"""Commands that change a change request, or move it toward live."""

from __future__ import annotations

import sys
from pathlib import Path

from .client import WikiError
from .local import read_folder, split_front_matter, title_from_slug
from .ops import Batch
from .session import Session
from .state import SyncState
from .sync import SyncPlan

EDITABLE = ("Draft", "Changes Requested")
FLAG_FIELDS = ("is_published", "is_group", "is_deleted", "is_tab", "is_external_link")


def cr_new(s: Session, args):
	sp = _writable_space(s, args.space)
	cr = s.wiki.create_cr(sp["name"], args.title)
	print(f"{cr['name']}  Draft  {args.title}\nexport WIKI_CR={cr['name']}")


def cr_draft(s: Session, args):
	"""Reuses your newest Draft / Changes Requested CR, which may hold older work."""
	sp = _writable_space(s, args.space)
	cr = s.wiki.draft_cr(sp["name"], args.title)
	pending = s.wiki.diff(cr["name"]) or []
	print(f"{cr['name']}  {cr['status']}  {cr['title']}\nexport WIKI_CR={cr['name']}")
	if pending:
		print(
			f"warning: already holds {len(pending)} change(s). `cr show` lists them; `cr new` starts clean."
		)


def cr_transition(s: Session, args):
	s.wiki.transition(s.cr, args.action)
	print(f"{s.cr}: {args.action} done")


def write(s: Session, args):
	# A group holds no content, so there is nothing to read.
	meta, body = ({}, "") if args.group else split_front_matter(_read_input(args.file))
	tree = s.tree()
	path = tree.normalize(args.path)
	title = args.title or meta.get("title")
	published = not args.unpublished and meta.get("published", True) is not False
	batch = Batch()
	node = tree.find(path)
	if node:
		if node.is_group != args.group:
			kind = "group" if node.is_group else "page"
			raise WikiError(f"'{path}' is a {kind}; {'add' if node.is_group else 'drop'} --group to match it")
		fields = {}
		if title and title != node.title:
			fields["title"] = title
		if node.is_published != published:
			fields["is_published"] = int(published)
		if not node.is_group:
			batch.update_content(node.key, body, fields.pop("title", None), label=path)
		if fields:
			batch.update_fields(node.key, fields, label=path)
	else:
		parent_path, _, slug = path.rpartition("/")
		parent_key = _ensure_parents(tree, batch, parent_path, args.parents)
		batch.create(
			parent_key,
			title or title_from_slug(slug),
			slug,
			group=args.group,
			content=body,
			published=published,
			label=path,
		)
	s.apply(batch)


def set_fields(s: Session, args):
	node = s.tree().get(args.path)
	fields = {}
	for pair in args.assignments:
		key, sep, value = pair.partition("=")
		if not sep:
			raise WikiError(f"expected field=value, got '{pair}'")
		fields[key] = int(value.lower() in ("1", "true", "yes")) if key in FLAG_FIELDS else value
	batch = Batch()
	batch.update_fields(node.key, fields, label=node.path)
	s.apply(batch)


def move(s: Session, args):
	tree = s.tree()
	node = tree.get(args.path)
	batch = Batch()
	batch.move(node.key, _group_key(tree, args.parent), args.index, label=f"{node.path} → {args.parent}/")
	s.apply(batch)


def remove(s: Session, args):
	node = s.tree().get(args.path)
	doomed = _subtree(node)
	print(f"deletes {len(doomed)} page(s) from this change request:")
	print("\n".join(f"  {p}" for p in doomed))
	if not args.yes:
		print("dry run. Re-run with --yes to delete.")
		return
	batch = Batch()
	batch.delete(node.key, label=node.path)
	s.apply(batch)
	print(f"undo before merge: set {node.key} is_deleted=0")


def sync(s: Session, args):
	folder = Path(args.folder)
	if not folder.is_dir():
		raise WikiError(f"not a folder: {folder}")
	tree = s.tree()
	at = tree.normalize(args.at or "")
	state = SyncState(folder, s.site, tree.root_key, at)
	last = state.load(s.cr, lambda cr: _merged(s, cr))
	plan = SyncPlan(
		tree, lambda key: s.wiki.page(s.cr, key).get("content") or "", args.reorder, last, args.force
	)
	plan.build(read_folder(folder), at)
	print(f"{plan.unchanged} unchanged")
	if plan.extras:
		print("on the wiki but not in the folder (left alone):\n" + "\n".join(f"  {p}" for p in plan.extras))
	if plan.conflicts:
		print(
			"edited on the wiki since the last sync (skipped; `cat PATH` shows the wiki's text, --force overwrites):\n"
			+ "\n".join(f"  {p}" for p in plan.conflicts)
		)
	if args.dry_run:
		print("\n".join(plan.batch.log) or "nothing to change")
		print("dry run: nothing sent")
		return
	s.apply(plan.batch)
	state.save(s.cr, plan.synced)
	if plan.conflicts:
		raise WikiError(f"{len(plan.conflicts)} page(s) skipped as conflicts")


def publish(s: Session, args):
	cr = s.wiki.get_cr(s.cr)
	if cr["status"] not in (*EDITABLE, "In Review", "Approved"):
		raise WikiError(f"{s.cr} is {cr['status']}; nothing to publish")
	outdated = s.wiki.is_outdated(s.cr)
	changes = s.wiki.diff(s.cr) or []
	for r in changes:
		print(f"{r['change_type']:>9}  {r.get('title')}")
	if outdated:
		print("main moved since this change request started. The server tries a three-way merge.")
	if not args.yes:
		print(
			f"{len(changes)} change(s). Merging publishes them live and cannot be undone.\n"
			"Show this list to the user; re-run with --yes once they agree."
		)
		return
	status = cr["status"]
	if status in EDITABLE:
		s.wiki.transition(s.cr, "submit")
		status = "In Review"
	if status == "In Review":
		s.wiki.transition(s.cr, "approve")
	try:
		revision = s.wiki.transition(s.cr, "merge")
	except WikiError as e:
		if "conflict" not in str(e).lower():
			raise
		raise WikiError(
			f"{e}\nNothing went live. Run `conflicts`, and read SKILL.md § Merge conflicts before resolving."
		) from e
	print(f"merged {s.cr} → revision {revision}")
	_verify_live(s, changes)


def _verify_live(s: Session, changes: list[dict]):
	"""Every added or modified page must now be a live document. The exit code says so."""
	expected = {r["doc_key"]: r.get("title") for r in changes if r["change_type"] != "deleted"}
	live = {d["doc_key"] for d in s.wiki.live_documents()}
	missing = [f"{title} ·{key}" for key, title in expected.items() if key not in live]
	if missing:
		raise WikiError("merged, but not live yet:\n" + "\n".join(f"  {m}" for m in missing))
	print(f"verified: {len(expected)} page(s) live")


def _merged(s: Session, cr: str) -> bool:
	try:
		return s.wiki.get_cr(cr)["status"] == "Merged"
	except WikiError:  # deleted, or no longer readable
		return False


def _writable_space(s: Session, phrase: str) -> dict:
	sp = s.space(phrase)
	if sp.get("git_synced"):
		raise WikiError(f"{sp['space_name']} is git-synced: the wiki refuses writes. Edit its GitHub repo.")
	if not s.wiki.capabilities(sp["name"]).get("can_contribute"):
		raise WikiError(f"you cannot contribute to {sp['space_name']}")
	return sp


def _ensure_parents(tree, batch: Batch, parent_path: str, create: bool) -> str:
	if not parent_path or tree.find(parent_path):
		return _group_key(tree, parent_path)
	if not create:
		raise WikiError(f"no group at '{parent_path}'. Pass --parents to create it. {tree.hint(parent_path)}")
	key, walked = tree.root_key, ""
	for slug in parent_path.split("/"):
		walked = f"{walked}/{slug}" if walked else slug
		if tree.find(walked):
			key = _group_key(tree, walked)
		else:
			key = batch.create(key, title_from_slug(slug), slug, group=True, label=walked)
	return key


def _group_key(tree, path: str) -> str:
	"""Only a group (or the space root) can hold pages."""
	path = tree.normalize(path)
	if path and not tree.get(path).is_group:
		raise WikiError(f"'{path}' is a page, not a group; pages cannot hold other pages")
	return tree.key_of(path)


def _subtree(node) -> list[str]:
	out = [node.path]
	for child in node.children:
		if not child.is_deleted:
			out += _subtree(child)
	return out


def _read_input(file: str) -> str:
	return sys.stdin.read() if file == "-" else Path(file).read_text()
