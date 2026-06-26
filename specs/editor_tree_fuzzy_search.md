# Editor Tree Fuzzy Search

Date: 2026-06-26
Status: **Implemented & verified** (2026-06-26). Unit tests green (`useTreeSearch.test.js`, 6/6), e2e green (`e2e/tests/tree-search.spec.ts`), build clean. See [Verification](#verification).

## Goal

In a large wiki space the editor sidebar tree (groups + pages, deeply nested) becomes hard to navigate — finding one page means hand-expanding groups and eyeballing the list. Add a **search box at the top of the editor tree** that fuzzy-matches page/group titles and lets the author jump straight to a result.

Constraints from the request:

- **Frontend-only.** The whole tree is already in memory (Pinia store). No new SQL, no backend endpoint, no network round-trip.
- **Keep it simple.** Match against the node `title` **and** `route` (the slug/path authors often remember better than the title). A tiny fuzzy-search lib is fine; no heavy config.

## Library Choice: `fuzzysort`

We web-searched the small-JS-fuzzy-search field (fuzzysort, Fuse.js, uFuzzy, microfuzz). Recommendation: **[`fuzzysort`](https://github.com/farzher/fuzzysort)**.

| Lib | Size (min) | Why / why not |
| --- | --- | --- |
| **fuzzysort** ✅ | ~5 KB, 0 deps | Purpose-built for SublimeText-style file/title search — exactly our case. `fuzzysort.go(query, targets, {keys, limit})` searches **multiple keys** (title + route) in one call and returns ranked results with per-key `.highlight()`. Simplest API for "few fields, ranked, highlighted." |
| Fuse.js | ~12 KB+ gzip | Weighted multi-key search, lots of tuning knobs. Overkill for one field. |
| uFuzzy | ~3 KB | Tiniest, but lower-level (you wire up the highlight/sort yourself). More glue for no real win here. |
| microfuzz | ~1 KB | Fine, but less battle-tested and fewer ranking niceties than fuzzysort. |

`fuzzysort` wins on "smallest library that gives ranking **and** highlight out of the box." Add via yarn:

```
cd frontend && yarn add fuzzysort
```

(Single dep, zero transitive deps. Codebase is yarn — `frontend/yarn.lock`.)

## Current State

- **Tree container:** `frontend/src/components/WikiDocumentList.vue` — receives the whole tree as `treeData` (`{ root_group, children: [...] }`), renders the New Group/Page/Link button row (lines 3–13) above the `<NestedDraggable>` (lines 31–49). The button row is the natural mount point for the search box.
- **Recursive renderer:** `frontend/src/components/NestedDraggable.vue` — draws one row per node via `vuedraggable`'s `<draggable>` `#item` slot. Row click → `handleRowClick(element)` (lines 243–271) which routes to `SpacePage` (published, by `document_name`) or `DraftChangeRequest` (unsynced draft, by `doc_key`); groups toggle expand; external links open the edit dialog.
- **Node shape** (snake_case, the `treeAsLegacy` projection from `stores/draftWorkspace/treeModel.js`):
  ```js
  { doc_key, document_name, title, route, is_group, is_published,
    is_external_link, external_url, order_index, children: [...], local_status }
  ```
  `title` is the display text for **all** node types (group, page, external link) — there is no separate name field. Type is distinguished only by `is_group` / `is_external_link`.
- The full tree is loaded once and held in frontend state — no lazy loading. So a flat client-side scan is trivially cheap.
- **No existing search/filter UI** anywhere in the tree. No fuzzy lib installed.
- Stack: Vue 3.5, frappe-ui (`FormControl`, `TextInput`, `Button` available), `@vueuse/core` (`useDebounceFn` available), `~icons/lucide/*` virtual icons. Biome lint, **tab indentation** in `.vue` script blocks.

## Non-Goals

- No backend search / no SQL / no API endpoint — purely client-side over the in-memory tree.
- No full-text / page-**content** search. Title-only. (Content search is a possible later, separate feature.)
- No change to the reorder logic, the node data shape, or routing. (Drag is *temporarily disabled* while a query is active, then restored — the reorder machinery itself is untouched.)
- No multi-field weighting, no search history, no recents.
- Read-only (git-synced) spaces get the same search — search is orthogonal to read-only.

## Design

**Core idea:** filter the **existing tree in place** — keep matching pages/groups, prune everything else, and auto-expand the ancestors of every match. This preserves hierarchy and the author's spatial memory ("this page lives under that group"), which a flat list would discard. We render the **same `<NestedDraggable>`**, just fed a pruned tree and with drag disabled while a query is active (so the drag-vs-filtered-DOM conflict simply never arises).

- `searchQuery === ''` → render the live `treeData`, drag enabled, saved expand state — i.e. today's behavior, untouched.
- `searchQuery !== ''` → render a **pruned copy** of the tree, drag disabled, all ancestors-of-matches force-expanded, matched titles highlighted.

### 1. Match → prune → expand (composable `useTreeSearch.js`)

```js
import fuzzysort from 'fuzzysort';

// Walk once → flat list of every node with its ancestor doc_keys.
function flatten(children, ancestors = []) → [{ node, ancestorKeys: [...] }]
```

Then, given a query, compute the set of nodes to keep and the set to expand:

```js
const matched = computed(() => {
  const q = query.value.trim();
  if (!q) return null; // null => "not searching", render full tree
  // Multi-key: match title OR route. fuzzysort ranks by the best-scoring key.
  const hits = fuzzysort.go(q, flat.value, { keys: ['node.title', 'node.route'] });
  const keep = new Set();       // doc_keys to render
  const expand = new Set();     // group doc_keys to force-open
  const score = new Map();      // doc_key -> fuzzysort result (for highlight)
  for (const r of hits) {
    keep.add(r.obj.node.doc_key);
    score.set(r.obj.node.doc_key, r); // r[0] = title match, r[1] = route match
    for (const a of r.obj.ancestorKeys) { keep.add(a); expand.add(a); }
  }
  return { keep, expand, score };
});
```

With `keys`, each result `r` is an array (`r[0]` = title result, `r[1]` = route result); either can be null if that field didn't match. fuzzysort scores the row by its best-matching key, so a route-only hit still surfaces.

Then build the **pruned tree** (a filtered structural copy, original order preserved — do **not** reorder by score; in-tree position is the whole point):

```js
function prune(children, keep) {
  return children
    .filter((n) => keep.has(n.doc_key))
    .map((n) => ({ ...n, children: prune(n.children || [], keep) }));
}
const treeForRender = computed(() =>
  matched.value ? { ...treeData, children: prune(treeData.children, matched.value.keep) }
                : treeData,
);
```

A group is kept iff it is an ancestor of a match (added to `keep` via `ancestorKeys`); a leaf is kept iff it matched directly. So a group whose own title matches but has no matching descendants still shows (it's in `keep`) — correct.

- `flat` rebuilds via `computed` off `treeData`, so create/rename/delete reflect immediately. Cost is a negligible in-memory walk.
- No `limit` — pruning already bounds what renders, and we *want* every match visible in context. (If a query matches thousands, that's the user's query; the tree just shows them all, same as today.)
- Debounce the bound query with `useDebounceFn` (~120 ms) only if typing feels laggy; likely unneeded at this data size.

### 2. Search box UI — `WikiDocumentList.vue`

Add above the button row (or beside it). frappe-ui `TextInput` with a leading `~icons/lucide/search` and a clear (`x`) button when non-empty. `Esc` clears the query. The pruned `treeForRender` is passed to `<NestedDraggable>` in place of `treeData`.

```
[ 🔍  Search pages…                       ✕ ]
```

### 3. Wiring `NestedDraggable` (minimal, additive)

Three small, backward-compatible additions to the recursive renderer:

1. **Force-expand during search.** `isExpanded(key)` already reads per-space `expandedNodes` from `useStorage`. Add an optional `expandedOverride` prop (a `Set` of doc_keys, threaded down through the recursion). `isExpanded` returns `true` when `key ∈ expandedOverride`, else falls back to saved state. This force-opens ancestors of matches **without clobbering** the user's saved expand state — clear the query and their tree is exactly as they left it.
2. **Disable drag during search.** `<draggable :disabled="readonly">` → `:disabled="readonly || searchActive"`. Pass `searchActive` (a boolean prop) down the recursion. No reorder while filtered.
3. **Highlight matches.** Pass the `score` map down. For a node with a hit, if the **title** key matched (`r[0]`) render `r[0].highlight('<mark>', '</mark>')` via `v-html` instead of `{{ element.title }}` (fuzzysort escapes the input, so only the injected `<mark>` is live — safe). If only the **route** matched (`r[1]` but not `r[0]`), render the plain title and surface the highlighted route as muted subtext beneath it (`r[1].highlight(...)`) so the author sees *why* it matched. Non-matched ancestor groups render their plain title.

Navigation, icons, badges, dialogs — **all unchanged**. `handleRowClick` already does the right thing (page → `SpacePage`, draft → `DraftChangeRequest`, group → toggle, link → edit dialog). Clicking a result is just clicking a tree row.

- Empty state: non-empty query, zero matches → render a small "No pages match '<q>'" message in place of the tree (mirrors the existing "No pages yet" empty block in `WikiDocumentList.vue` lines 15–29).

### Tracer-bullet phases

1. **Phase 1 — vertical slice.** `yarn add fuzzysort`; `useTreeSearch` composable (flatten + match + prune); `TextInput` in `WikiDocumentList`; pass pruned `treeForRender` + `expandedOverride` + `searchActive` into `NestedDraggable`. Result: typing filters the real tree, ancestors auto-expand, drag off, navigation works. Ship this. `yarn build`.
2. **Phase 2 — polish.** Title highlight (`<mark>`), `Esc`-to-clear / clear button, empty-state message, restore-saved-expand-on-clear verified. Debounce only if needed.
3. **Phase 3 — tests.** Unit test for `flatten` + `prune` + match set (deterministic, no DOM): given a tree and a query, assert the kept/expanded doc_key sets. Playwright e2e: open a space in edit mode, type a partial title, assert non-matching siblings are gone, the match's parent group is expanded, and clicking the match navigates to that page. (Mind the local job-queue meltdown noted for git-sync specs — keep this e2e lean, no sync.)

## Open Questions

1. **Highlight** via `v-html` of fuzzysort's escaped output — acceptable, or hand-roll index-based `<mark>` spans to avoid any `v-html`? Default: use fuzzysort's highlight (it escapes input).
2. Debounce needed at all? Default: no, add only if laggy.
3. On clear, should focus return to the tree / last-selected row, or stay in the search box? Default: stay in box (cheapest), revisit if it feels off.

## Verification

- **Unit** (`frontend/src/composables/useTreeSearch.test.js`, `node --test`, 6/6 pass): blank query → no filtering; title match keeps page + ancestor group and prunes siblings; route-only match (`auth-tokens`) surfaces a page whose title doesn't match; fuzzy/non-contiguous query (`athn` → "Authentication"); no-match → empty keep set; group-title match keeps the group.
- **Build**: `yarn build` clean.
- **E2E** (`e2e/tests/tree-search.spec.ts`, **passing**): seeds a space via API and drives the search box — title filter + auto-expand + prune, route-only match (`auth-tokens`), no-match empty state, clear-restores. Run with:
  `BASE_URL=http://wiki.localhost:8000 yarn test:e2e e2e/tests/tree-search.spec.ts`
- **Manual** (pending): large space on wiki.localhost — fuzzy title/route search → matches in context, click navigates.
