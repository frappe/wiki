"""Commands that only read."""

from __future__ import annotations

import difflib

from .session import Session, format_spaces


def spaces(s: Session, args):
	print(format_spaces(s.wiki.spaces()))


def space(s: Session, args):
	sp = s.space(args.phrase)
	caps = s.wiki.capabilities(sp["name"])
	can = [k[4:] for k, v in caps.items() if k.startswith("can_") and v]
	print(f"{sp['space_name']} → {sp['name']}  /{sp['route']}  can: {', '.join(can) or 'nothing'}")
	if sp.get("git_synced"):
		print("git-synced: every write is refused. Edit the GitHub repo instead.")


def cr_list(s: Session, args):
	sp = s.space(args.space)
	for c in s.wiki.list_crs(sp["name"], args.status):
		print(f"{c['name']}  {c['status']:<17}  {c['modified'][:16]}  {c['owner']}  {c['title']}")


def cr_show(s: Session, args):
	c = s.wiki.get_cr(s.cr)
	print(f"{c['name']}  {c['status']}  space={c['wiki_space']}  {c['title']}")
	if c["status"] in ("Draft", "Changes Requested", "In Review", "Approved"):
		print(
			"outdated: main moved since this branch started"
			if s.wiki.is_outdated(s.cr)
			else "up to date with main"
		)
	_print_summary(s.wiki.diff(s.cr))


def tree(s: Session, args):
	print(s.tree().render(args.under or "", args.depth))


def cat(s: Session, args):
	node = s.tree().get(args.path)
	print(s.wiki.page(s.cr, node.key).get("content") or "", end="")


def diff(s: Session, args):
	if not args.path:
		_print_summary(s.wiki.diff(s.cr))
		return
	node = s.tree().get(args.path)
	d = s.wiki.diff(s.cr, node.key)
	base, head = d.get("base") or {}, d.get("head") or {}
	if not base or not head:
		print("new page" if head else "deleted page")
	else:
		for field in ("title", "slug", "is_published"):
			if base.get(field) != head.get(field):
				print(f"{field}: {base.get(field)!r} → {head.get(field)!r}")
	lines = difflib.unified_diff(
		(base.get("content") or "").splitlines(),
		(head.get("content") or "").splitlines(),
		"published",
		"this change request",
		lineterm="",
		n=2,
	)
	print("\n".join(lines) or "(content unchanged)")


def live(s: Session, args):
	"""Published state on main, which is what readers see."""
	prefix = args.prefix.strip("/")
	rows = [d for d in s.wiki.live_documents() if d["route"] == prefix or d["route"].startswith(prefix + "/")]
	for d in sorted(rows, key=lambda d: d["route"]):
		flags = ("/" if d["is_group"] else "") + ("" if d["is_published"] else "  [unpublished]")
		print(f"/{d['route']}{flags}  ·{d['doc_key']}")
	print(f"{len(rows)} live document(s) under /{prefix}")


def conflicts(s: Session, args):
	rows = s.wiki.conflicts(s.cr)
	for c in rows:
		print(
			f"{c['name']}  {c['conflict_type']}  {c.get('theirs_title') or c.get('ours_title')}  ·{c['doc_key']}"
		)
	print(
		f"{len(rows)} open conflict(s). Resolve them in the wiki UI, or see reference/api.md § Merge conflicts."
	)


def _print_summary(rows: list[dict]):
	for r in rows or []:
		kind = "group" if r.get("is_group") else "page"
		print(f"{r['change_type']:>9}  {kind:<5}  {r.get('title')}  ·{r['doc_key']}")
	print(f"{len(rows or [])} change(s)")
