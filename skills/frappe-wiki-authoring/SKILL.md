---
name: frappe-wiki-authoring
description: Frappe Wiki authoring and publishing through change requests, with the wikictl.py helper over frappectl. Use when the user wants to add, edit, restructure, sync or delete wiki pages; names a wiki space ("the Buzz wiki", "our handbook", "our docs"); or mentions Wiki Change Request, wiki CR, or apply_cr_operations.
---

# Frappe Wiki authoring

A change request (CR) is a **branch**. You write pages into it, then submit, approve and
merge it to publish. Git intuition works, with one inversion: see
[Merge conflicts](#merge-conflicts).

This needs Wiki v3 (Wiki Document, Wiki Change Request, Wiki Revision). The legacy v2
`Wiki Page` doctypes have no change requests.

## The tool

`scripts/wikictl.py` wraps frappectl. It uses only the standard library and Python 3.10+.
Every page is addressed by its **slug path** below the space root, such as
`guides/setup/install`. A doc_key also works. The tool does the version bookkeeping, the
temp keys and the stdin transport, so you never write `apply_cr_operations` JSON by hand.

```bash
wikictl() { python3 <this skill's folder>/scripts/wikictl.py "$@"; }
export WIKI_SITE=<frappectl profile>   # or -s on each call
```

Use a shell function. An alias does not expand in a non-interactive shell, and zsh does
not split a command kept in a variable.

## Before you start

The user owns the frappectl profile. Check it first:

```bash
frappectl -s <profile> auth whoami
```

When the user names a site, use that profile. When there are several profiles and no
name, ask. When the site has no profile, stop and tell the user to make one. Run no other
`auth` command. Do not set `FRAPPE_*` variables.

Every action on the site goes through the tool or frappectl. Do not read or write the
site's database, files or bench, even when the site runs on this machine. You may not
have the wiki source. Nothing here needs it.

`reference/cli.md` has every command with examples. `reference/api.md` has the raw API,
for anything the tool does not cover.

## Workflow

1. Resolve the space. Echo the result so a wrong guess shows before any write.
   ```bash
   wikictl space "buzz"      # Buzz → en0gc980kr  /buzz  can: read, write, contribute
   ```
   - Several matches or none: the tool lists the spaces. Ask the user.
   - `git-synced`: stop. Every write is refused. The change belongs in the GitHub repo.
   - No `contribute`: stop. The CR would be unwritable.
   - No `write`: you can author and submit. Name who must approve.
2. Start a change request, then export it.
   ```bash
   wikictl cr new buzz -t "Add onboarding guide"
   export WIKI_CR=<name it prints>
   ```
   `cr draft` reuses your newest open draft instead. It warns when that draft already holds
   changes. Use `cr new` when the old work is not yours to mix with.
3. Look at the tree. Read only the part you need.
   ```bash
   wikictl tree guides -d 2
   wikictl cat guides/setup/install
   ```
4. Write pages.
   ```bash
   wikictl write guides/setup/install install.md      # create or replace
   wikictl write guides/new-area/intro intro.md --parents
   wikictl sync ./docs --at guides -n                  # preview a folder sync
   wikictl sync ./docs --at guides                     # then apply it
   wikictl set guides/old-name title="New title" slug=new-name
   wikictl mv guides/setup/install guides/start
   ```
   `sync` does not overwrite a page that someone edited on the wiki since the last sync.
   It lists the page as a conflict and exits 1. Show the user both versions (`cat` and
   the local file). Use `--force` only when they say so.

   The first sync of a folder into pages that already exist has no record yet. Every page
   whose text differs is then a conflict, even when nobody edited it. Expect this, compare,
   and ask the user before `--force`.

   Content is **raw markdown**. HTML is stored as it is and shows as literal text. The wiki
   shows the page title above the content, so do not start a page with a `#` heading.
5. Review.
   ```bash
   wikictl cr show                    # status, outdated check, change list
   wikictl diff guides/setup/install  # unified diff of one page
   ```
6. Publish. Without `--yes`, `publish` only prints the change list.
   ```bash
   wikictl publish          # show this list and the URLs to the user
   wikictl publish --yes    # after they agree: submit, approve, merge, verify
   ```
   After the merge, `publish` checks that every page is a live document. It exits 1 when
   one is missing. `wikictl live buzz/guides` shows what readers see.

## One-way doors

These actions have no undo. Ask the user first. Everything else can be reversed with
`cr withdraw` or `cr archive`, so do it without asking.

1. **Merge** (`publish --yes`) publishes live. Show the change list and the URLs first.
2. **Delete** (`rm --yes`) cascades to every page below. `rm` without `--yes` lists what
   goes. Before merge, `set <doc_key> is_deleted=0` restores it.
3. **Conflict resolution** discards one whole side. See below.

## Merge conflicts

`publish` refuses when main moved after the CR started (`outdated`). Resolution is per
whole page, there is no rebase, and the names are **reversed from git**:

> **`ours` = what is already live on main. `theirs` = the change request's work.**

So resolving with `ours` **throws away the author's edits.** Give conflicts to the user.
Run `wikictl conflicts`, show both versions of each page, and ask in plain words: "keep
your new text" or "keep what is already published". Then read `reference/api.md` §
Merge conflicts before you call anything.

## When a call fails

An error that names its cause has a fix in the table below. For an error with no cause:

1. Run the command once more. Change only what could matter.
2. Make the change smaller until you find the smallest one that still fails.
3. Stop and give the user the exact command and the exact error. Run the frappectl call
   again with `--debug` first: it prints the server's own messages.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `error: version_conflict` | someone wrote to the CR after your tree read | Run the command again. The tool reads the tree fresh each run. |
| `no page at '…'. Under '…': …` | wrong slug | Use one of the listed slugs, or `tree` to look. |
| `no group at '…'` | parent missing | Add `--parents`, or create the group first. |
| `There are no changes to submit for review.` | nothing changed in total | Create then delete, or a pure reorder, can cancel out. |
| `PermissionError` on every write | `git_synced` space | Edit the GitHub repo instead. |
| `You do not have permission to review…` | no Write on the space | Submit with `cr submit`, and hand off. |
| `Merge conflicts detected` | main moved | Give it to the user. Read the inversion above first. |
| `skipped as conflicts` from `sync` | the page changed on the wiki after the last sync | Show both versions to the user. `--force` only when they agree. |
| Page shows literal markup | HTML sent as content | Send markdown. |
| A field does not clear | `null` values are dropped | Set it to `""`. |
