# Test fixture factory: every test owns and destroys its own data

## Status

- **Branch**: `feat/frappe-ui-beta55`
- **Category**: tests / dx
- **Planned at**: 2026-09-07

## Why this matters

E2E runs leave permanent debris on the site. Measured on `wiki.localhost` before
any of this work:

```
spaces:               5
documents:          296
orphan root groups: 101
CRs: 32   revisions: 99
```

101 orphan root groups against 5 live spaces. Two independent leaks produce them.

### Leak 1 — specs build a root group the space already made

`WikiSpace.before_insert` calls `create_root_group()`, so every `Wiki Space`
arrives with a root group already attached. Eighteen specs nonetheless do this:

```ts
const space = await createTestWikiSpace(request, { route });
const rootGroup = await createTestWikiDocument(request, {
    title: 'Root', route: `${route}/root`, is_group: true,
});
await updateDoc(request, 'Wiki Space', space.name, { root_group: rootGroup.name });
```

The replacement wins, and the auto-created group is stranded: it carries no
`wiki_space` value and is not a descendant of the new root. `WikiSpace.on_trash`
deletes descendants of `self.root_group` plus anything whose `wiki_space` points
at the space — the orphan matches neither clause. Every seeded space leaks
exactly one root group, forever, even when the spec cleans up correctly.

### Leak 2 — specs that author into whatever space sorts first

Sixteen specs never seed at all. They `goto(APP_BASE)`, click
`spaceLinkSelector()` (bare — "any space"), and create pages through the UI.
Those pages land in a real space and are never removed. This is also the
mechanism behind the git-sync trap already documented in `cleanupWikiSpacesByRoute`:
a read-only space sorting first strands every later spec that expects a
"New Page" button.

### Cost of the current seeding ritual

Server-side work is cheap; round trips are not.

| Operation | Server time |
|---|---|
| space insert (incl. auto root group) | 0.38s |
| 3 child documents | 0.16s |
| delete space, full cascade | 0.27s |

A typical `beforeAll` spends **9 HTTP round trips** (space, root group,
`updateDoc`, then one per page) on ~0.5s of actual server work.

## Approach

One factory, used by every test, that seeds in bulk and tears down by
construction rather than by remembering to.

### Seeding is `1 + depth` round trips

`frappe.client.insert_many` inserts up to 200 documents in a single request and
returns their names positionally. The tree cannot go in one call: Wiki Document
has no `autoname`, and `set_new_name` (`frappe/model/naming.py:160`) nulls any
explicit `name` for that case, so a child's `parent_wiki_document` is unknowable
until its parent's insert returns. So the factory inserts **breadth-first, one
call per depth level**. Most specs are one level deep: 9 round trips becomes 2.

### Teardown is a single delete

The factory never replaces the root group, so leak 1 disappears. `on_trash`
already cascades documents, revisions, revision items, sync logs and change
requests, so one `deleteDoc` on the space reclaims the whole tree — including
pages a test created through the UI, since SPA drafts are `Wiki Change Request`
rows bound to the space (`frontend/src/stores/draftWorkspace/syncTransport.js`).

Teardown resolves spaces **by route**, not by the create response, so a space the
server made but whose response the client never saw — a timed-out create, or a
Playwright retry that seeded twice — is still swept. This preserves the
robustness `cleanupWikiSpacesByRoute` was written for.

### Routes carry a fixed prefix

Every factory-made space gets `e2e-<slug>-<counter>-<ts>`. A prefix makes the
sweeper provably unable to touch a real space.

## Design

### `e2e/helpers/factory.ts`

```ts
const space = await wiki.space({
    pages: [
        { title: 'Alpha' },
        { title: 'Beta', children: [{ title: 'Gamma' }] },
    ],
});

space.name;                 // Wiki Space docname
space.route;                // e2e-…
space.rootGroup;            // auto-created, not replaced
space.page('Alpha').name;   // by title
space.url();                // /wiki-app/spaces/<name>
space.url('page', id);      // deeper paths
```

`SpaceSpec` and `PageSpec` both spread unrecognised keys straight onto the
document, so `git_synced`, `repo_full_name`, `branch`, `is_tab`, `tab_icon`,
`source_path`, `sort_order` and anything added later need no factory change.

### `e2e/fixtures.ts`

Re-exports `test` with two fixtures over the same `WikiFactory` class:

- `wiki` — test-scoped. Torn down after each test. The default.
- `wikiSuite` — worker-scoped, for a `describe` whose tests genuinely share a
  seed. Owns its own `APIRequestContext` built from the stored auth state,
  because the built-in `request` fixture is test-scoped.

Teardown runs in the fixture's own `use()` epilogue, so there is no `afterAll`
to forget and no way for a failing test to skip it.

### `e2e/global.teardown.ts`

Sweeps `e2e-%` spaces and orphan root groups left by a crashed or killed run.
Wired as a Playwright `teardown` project so it runs once after the suite.

### `wiki/tests/factory.py`

The Python suite already tears down per file, but four modules carry their own
near-identical `create_test_wiki_space` / `create_test_wiki_document`
(`test_api.py`, `test_wiki_change_request.py`, `test_wiki_document.py`, plus
`_create_space` in the same file). One `WikiFixtures` mixin replaces them with
the same vocabulary as the TypeScript factory.

## Phases

Tracer bullet first: one spec end to end, proving the document count is
unchanged across a run, before touching the other 33.

1. **Sweep** the existing 101 orphans; add `global.teardown.ts`.
2. **Factory + fixture**, plus convert `space-default-page.spec.ts`. Verify
   counts before == after.
3. **Convert the 18 API-seeding specs** off the manual root group.
4. **Convert the 16 ambient-space specs** to seed their own space.
5. **Python `wiki/tests/factory.py`**; migrate the four duplicated helpers.

## Verification

Between each phase, on `wiki.localhost`:

```
spaces / documents / orphan root groups / CRs / revisions
```

must be identical before and after a full `yarn test:e2e` run.

## Out of scope

- A leak-detection guard test (considered, explicitly declined).
- Frontend unit tests — they are pure and touch no server state.

## Log

**Phase 1 — sweep.** 101 orphan root groups plus 30 stray documents removed;
`documents` went 296 → 165. `global.teardown.ts` added as a Playwright teardown
project, scoped to the `e2e-` route prefix.

**Phase 2 — factory.** `WikiFactory` seeds `1 + depth + 1` requests: one to
create the space, one `frappe.client.insert_many` per tree level, one read-back
for the routes the server derived. `space-default-page.spec.ts` converted as the
tracer; counts identical either side of its run.

`adopt(spaceName)` was added once the first spec turned up that has to create
its space through the app's own New Space dialog. `createSpaceViaDialog` in
`helpers/wiki.ts` wraps that path and adopts what it makes.

**Phases 3–4 — conversion.** 34 specs moved across. Two findings came out of it:

1. **The temp-key race.** A page created through the sidebar lands on
   `/draft/tmp_<uuid>` and is promoted to its real `doc_key` only once the
   create round-trips. Eleven specs read that segment straight after the create
   and then looked the document up by it. In a space that already had a tree the
   promotion won the race; seeding an empty space made it lose deterministically.
   `currentDraftDocKey` waits for the promotion. This fixed **17 tests that were
   already failing** on this branch — all 14 in `mobile-view.spec.ts`, plus
   `toc-navigation`, `page-actions-ai-url` and `sidebar`'s client-side-nav test.

2. **Tests that asserted nothing.** Three in `public-pages.spec.ts` wrapped
   every assertion in nested "if the first space happens to hold a published
   page" guards. Seeding the page let the guards go.

Two specs were also creating spaces by a path the initial inventory missed —
`mobile-view` (14 per run) and `change-request-flow` (14 per run) — because they
drive the New Space dialog rather than any helper the survey grepped for.

**Phase 5 — Python.** `wiki/tests/factory.py` holds the creation logic that
five near-identical `create_test_wiki_space` / `create_test_wiki_document`
implementations had each drifted their own copy of. Every module's helper keeps
its signature and delegates, so no call site moved.

The suites turned out to leak after all — not the orphan root group the e2e
specs did (Python sets `root_group` *before* insert, so `create_root_group`
no-ops) but whole spaces, for three reasons that each look like the code
working:

1. **Teardown deletes were never committed.** A test that commits its own
   inserts — the reorder and rebuild APIs commit on their own — leaves rows the
   framework's rollback cannot reach, and an *uncommitted delete* of those rows
   is itself rolled back. `test_api` leaked 7 spaces and 52 documents a run.
2. **Documents were deleted in reverse-insertion order.** `track_new` adopts
   rows in whatever order the query returns them, and the nested set refuses to
   delete a node that still has children. Ordered leaf-first now, as
   `Wiki Space.on_trash` already did.
3. **The v3 migrations build documents themselves**, and the orphan pass
   parents them nowhere, so no space's cascade reaches them.
   `snapshot_documents` / `track_new` adopt whatever the code under test made.

Sharing the factory also surfaced two traps worth recording:

- `Document.insert(ignore_permissions=True)` stores the flag **on the
  document**, so a fixture carried the bypass into any later `save()` on the
  same object. `test_regular_user_cannot_modify_space_settings` asserts a
  regular user *cannot* save a space, and it passed silently.
- Two classes in the Wiki Document suite define `setUp` without calling
  `super()`. A `setUp`-based mixin would leave them with no factory at all, so
  `WikiFixtureMixin` builds it lazily on first use and registers its own
  `addCleanup` there.

**Verified.** The whole Python suite — 134 integration, 270 all-category, 130
unit — passes with spaces, documents, Wiki Pages and revisions all identical
either side of the run.

**Phase 6 — CI was running a third of the suite.** `run-tests` takes
`--test-category`, and it defaults to `unit`, so every `IntegrationTestCase` was
skipped on every pull request: 130 tests of roughly 410, and none that touch the
database — including the suite that caught the `ignore_permissions` bug above.

Verified before flipping it, against a site built the way CI builds one
(`bench new-site`, `install-app wiki`, `allow_tests`), because the local site
carries data a fresh one would not: green at 137 integration, 279 all-category
and 130 unit, leaving behind only the two documents `install-app` itself
creates. The scratch site was dropped afterwards.
