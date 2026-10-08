#!/usr/bin/env python3
"""wikictl: author Frappe Wiki pages through change requests, via frappectl.

Pages are addressed by slug path (`guides/setup/install`) or doc_key. Set the
site and change request once:

    export WIKI_SITE=<frappectl profile>  WIKI_CR=<change request>

Run `wikictl.py <command> -h` for a command's options. reference/cli.md has
worked examples.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from wikitool import read_cmds as r
from wikitool import write_cmds as w
from wikitool.client import WikiError
from wikitool.session import Session


def main(argv=None) -> int:
	args = parser().parse_args(argv)
	try:
		args.run(Session(args.site, args.cr), args)
	except WikiError as e:
		print(f"error: {e}", file=sys.stderr)
		return 1
	return 0


def parser() -> argparse.ArgumentParser:
	p = argparse.ArgumentParser(
		prog="wikictl.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
	)
	p.add_argument("-s", "--site", help="frappectl profile (default: $WIKI_SITE, then frappectl's default)")
	p.add_argument("-c", "--cr", help="change request name (default: $WIKI_CR)")
	sub = p.add_subparsers(required=True, metavar="command")

	def cmd(name, fn, help_):
		c = sub.add_parser(name, help=help_, description=help_)
		if fn:  # `cr` leaves `run` to its own sub-actions
			c.set_defaults(run=fn)
		return c

	cmd("spaces", r.spaces, "list wiki spaces")
	cmd("space", r.space, "resolve a space by docname, route or name; show your access").add_argument(
		"phrase"
	)

	c = cmd("cr", None, "change requests: new, draft, list, show, submit, approve, withdraw, archive")
	crs = c.add_subparsers(required=True, metavar="action")
	n = crs.add_parser("new", help="start a fresh change request")
	n.add_argument("space"), n.add_argument("-t", "--title", required=True)
	n.set_defaults(run=w.cr_new)
	d = crs.add_parser("draft", help="reuse your newest open draft in the space, or start one")
	d.add_argument("space"), d.add_argument("-t", "--title")
	d.set_defaults(run=w.cr_draft)
	ls = crs.add_parser("list", help="change requests in a space")
	ls.add_argument("space"), ls.add_argument("--status")
	ls.set_defaults(run=r.cr_list)
	crs.add_parser("show", help="status, outdated check and change summary").set_defaults(run=r.cr_show)
	for action in ("submit", "approve", "withdraw", "archive"):
		crs.add_parser(action, help=f"{action} the change request").set_defaults(
			run=w.cr_transition, action=action
		)

	t = cmd("tree", r.tree, "the page tree: slug/  Title  ·doc_key")
	t.add_argument("under", nargs="?", help="only below this path")
	t.add_argument("-d", "--depth", type=int)
	cmd("cat", r.cat, "print a page's markdown").add_argument("path")

	wr = cmd("write", w.write, "create or replace a page from a markdown file (or - for stdin)")
	wr.add_argument("path"), wr.add_argument("file", nargs="?", default="-")
	wr.add_argument("-t", "--title")
	wr.add_argument("--group", action="store_true", help="create a group instead of a page")
	wr.add_argument("--parents", action="store_true", help="create missing parent groups")
	wr.add_argument("--unpublished", action="store_true")

	st = cmd("set", w.set_fields, "set page fields: title=… slug=… is_published=0 is_deleted=0")
	st.add_argument("path"), st.add_argument("assignments", nargs="+")
	mv = cmd("mv", w.move, "move a page under another group ('' is the space root)")
	mv.add_argument("path"), mv.add_argument("parent"), mv.add_argument("-i", "--index", type=int)
	rm = cmd("rm", w.remove, "delete a page and everything under it (dry run without --yes)")
	rm.add_argument("path"), rm.add_argument("--yes", action="store_true")

	sy = cmd("sync", w.sync, "make a subtree match a local folder of .md files (never deletes)")
	sy.add_argument("folder"), sy.add_argument("--at", help="wiki path to sync into (default: space root)")
	sy.add_argument("--reorder", action="store_true", help="also match the folder's order")
	sy.add_argument("-n", "--dry-run", action="store_true")
	sy.add_argument(
		"--force", action="store_true", help="overwrite pages edited on the wiki since the last sync"
	)

	df = cmd("diff", r.diff, "change summary, or a unified diff of one page")
	df.add_argument("path", nargs="?")
	pb = cmd("publish", w.publish, "submit, approve and merge (preview without --yes)")
	pb.add_argument("--yes", action="store_true", help="the user has agreed: go live")
	cmd("live", r.live, "published documents under a route, as readers see them").add_argument("prefix")
	cmd("conflicts", r.conflicts, "open merge conflicts")
	return p


if __name__ == "__main__":
	sys.exit(main())
