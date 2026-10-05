# wikictl.py command reference

```
python3 scripts/wikictl.py [-s PROFILE] [-c CR] <command> …
```

`-s` defaults to `$WIKI_SITE`, then to frappectl's default profile. `-c` defaults to
`$WIKI_CR`. Errors go to stderr with exit code 1.

## Paths

A path is the chain of slugs below the space root.

| You write | It means |
|---|---|
| `guides/setup/install` | the page `install` in group `setup` in group `guides` |
| `/buzz/guides/setup/install` | the same: a leading `/` and the space route are dropped |
| `487291614eed` | the page with this doc_key, including a page staged as deleted |
| `""` | the space root (for `mv`) |

A wrong path fails with the slugs that do exist at the nearest level:

```
error: no page at 'guides/instal'. Under 'guides': install, faq
```

## Output format

`tree` prints one node per line: the slug (`/` after a group), the title, and the doc_key
after `·`. Flags follow in brackets.

```
guides/  Guides  ·560a02e25cc4
  install  Install the app  ·c06f12859217
  old  Old page  ·769998326d9d [draft-deleted]
```

Write commands print one line per operation, then the new CR version:

```
create  guides/new-area
create  guides/new-area/intro
applied 2 op(s) to btd45q9sct, now v4
```

## Spaces

| Command | Does |
|---|---|
| `spaces` | List every space: docname, route, name, and `git-synced` or `contributions off` flags. |
| `space PHRASE` | Resolve a docname, route or name to one space. Show your access. |

## Change requests

| Command | Does |
|---|---|
| `cr new SPACE -t TITLE` | Start a fresh CR. Prints `export WIKI_CR=…`. |
| `cr draft SPACE [-t TITLE]` | Reuse your newest Draft or Changes Requested CR, or start one. Warns when it already holds changes. |
| `cr list SPACE [--status S]` | CRs in the space, newest first. |
| `cr show` | Status, the outdated check, and the change list. |
| `cr submit` / `approve` / `withdraw` / `archive` | Move the CR to the next status. |

## Reading

| Command | Does |
|---|---|
| `tree [PATH] [-d N]` | The tree, or the part below PATH, N levels deep. |
| `cat PATH` | The page markdown, exactly as stored. |
| `diff` | The change list of the CR. |
| `diff PATH` | A unified diff of one page against main, plus changed title, slug and publish flag. |
| `live PREFIX` | Published documents whose route starts with PREFIX. This is what readers see. |
| `conflicts` | Open merge conflicts. |

## Writing

All write commands send one batch. A failure changes nothing.

`write PATH [FILE]` creates the page, or replaces its content. FILE `-` (the default)
reads stdin. Options:

| Option | Effect |
|---|---|
| `-t TITLE` | The title. Default: the file's front matter `title`, then the slug as words. |
| `--parents` | Create missing parent groups. |
| `--group` | Create a group, not a page. No FILE is read. |
| `--unpublished` | Create or set the page as unpublished. |

```bash
wikictl write guides/faq faq.md
printf 'Short page.\n' | wikictl write guides/note - -t "A note"
```

`set PATH FIELD=VALUE …` sets page fields. The fields are `title`, `slug`, `route`,
`external_url`, `tab_icon`, and the flags `is_published`, `is_group`, `is_deleted`,
`is_tab`, `is_external_link`. Flags take `1`, `0`, `true` or `false`.

`mv PATH PARENT [-i INDEX]` moves a page under another group. `''` is the space root.

`rm PATH [--yes]` deletes the page and everything below it. Without `--yes`, it only
lists what would go. After a delete, it prints the doc_key to restore with
`set KEY is_deleted=0`.

## Syncing a folder

`sync FOLDER [--at PATH] [--reorder] [-n]` makes the wiki below PATH match the folder.

```
docs/              # maps to --at PATH, which must exist
  install.md       # page "install"
  setup/           # group "setup"
    _group.md      # title and order for "setup"
    linux.md
```

A file can start with front matter. The front matter is not sent to the wiki.

```
---
title: Install the app
order: 2
published: false
---
```

| Rule | Detail |
|---|---|
| Match | By slug: the file name without `.md`, or the folder name. |
| Create | Pages and groups that are missing. |
| Update | Content, title and publish flag, when they differ. |
| Order | New pages go in folder order. With `--reorder`, existing pages move into folder order too. Items with `order` come first, then the rest by name. |
| Delete | Never. Pages that exist only on the wiki are listed as "left alone". Use `rm`. |
| Protect | A page or group whose text, title or publish flag changed on the wiki since the last sync is skipped and listed as a conflict. Its children still sync. The command then exits 1. `--force` overwrites it. |
| Preview | `-n` prints the operations and sends nothing. |

Sync keeps `.wikictl-sync.json` in the folder. For each change request it records, per
page and group, a hash of the title, publish flag and text that sync wrote. An item is
changed only when the wiki still holds what a trusted record says. A record is trusted when
its change request is the current one or was merged. A record from an archived draft never
reached main, so it is ignored.

The file belongs to one site and one `--at` path. The first sync to a new target finds no
record, so every existing item that differs is a conflict. Compare them, then use
`--force`. Commit the file with the folder when other people sync it too.

Sync reads every existing page once to compare content. On a large subtree, sync the
smallest folder that holds your change.

## Publishing

`publish` prints the change list, and a warning when the CR is outdated. With `--yes`, it
submits, approves and merges, skipping the steps already done. On an outdated CR the server
tries a three-way merge. If pages conflict, nothing goes live and the command points to
`conflicts`. Then it checks that
every added or modified page is a live document, and exits 1 if one is not.

## Tests

```bash
python3 -m unittest discover -s scripts/tests
```

The tests cover path resolution, front matter, and sync planning. They do not need a site.
