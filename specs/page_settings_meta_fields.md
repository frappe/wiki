# Page Settings Dialog + Meta (SEO) Fields

Date: 2026-07-03
Status: **Phases 1–5 implemented & verified** (2026-07-03) on wiki.localhost,
including e2e playwright coverage and BreadcrumbList JSON-LD. Branch:
`feat/meta-fields`.

## Goal

Give each wiki page configurable SEO meta fields — meta title, meta description,
meta image — editable from a new per-page **Page Settings** dialog in the editor
SPA, and actually emit them (plus canonical/og/twitter tags) on the public
server-rendered HTML, which today has almost no SEO surface.

## Current State (audited 2026-07-03)

### Public head is nearly empty
Public pages render via the custom `WikiDocumentRenderer`
(`wiki_document.py:461`) → `templates/wiki/document.html` →
`templates/wiki/layout.html`. The `<head>` emits only: charset, viewport,
`<title>{{ doc.title }}</title>`, favicon link, and the free-form `head_html`
blob from Wiki Settings (`layout.html:52`). **Missing:** meta description,
`og:*`, `twitter:*`, canonical, robots, JSON-LD, sitemap. The renderer bypasses
Frappe's `web.html`/`context.metatags` machinery entirely — `get_web_context()`
(`wiki_document.py:345-409`) builds a plain dict with no `metatags` key.

### Doctypes
- **Wiki Document** (active v3): no meta fields at all.
- **Wiki Page** (legacy v2, dead renderer): had `meta_description`,
  `meta_image`, `meta_keywords` — the feature regressed in v3.
- **Wiki Space**: only `favicon`; no space-level meta defaults.

### Frontend
- `WikiDocumentSettings.vue` is an **orphan** (zero importers): a "Page
  Settings" Dialog with Title + Route saving via `frappe.client.set_value` —
  ready-made skeleton.
- Per-page actions live in the page-header `...` dropdown
  (`WikiDocumentPanel.vue:402` `menuOptions`: Publish/Unpublish, Edit on
  GitHub, View in Desk).
- Save convention elsewhere: `createDocumentResource(...).setValue.submit({...})`
  (SpaceSettings panels).
- Image upload convention: `useFileUpload()` + endpoint
  `wiki.api.upload_wiki_asset` (WebP conversion) — see `WikiEditor.vue:124-154`.

### Prior art studied: Frappe Builder
Builder groups Page + Global settings in one sidebar dialog; its **Meta** tab
has Title / Description / Image plus a live **social preview card**
(`builder/frontend/src/components/Settings/PageMeta.vue`). Backend sets
`context.metatags = {title, description, image}` and lets the framework
include `templates/includes/meta_block.html` emit all og/twitter/description
tags — Builder writes zero og tags by hand. We copy the metatags/meta_block
approach and the preview card; we do **not** copy the merged grouped dialog.

## Decisions

1. **Separate Page Settings dialog** (decided 2026-07-03, over extending
   SpaceSettings with a "Current Page" group). Purpose-scoped to the open
   page; Space Settings stays space-scoped. Future page-level settings
   (route, robots, redirects) get a natural home; existing Change-Title /
   Route dialogs can fold in later, keeping total dialog count down.
2. **Reuse framework `meta_block.html`** via `context.metatags` instead of
   hand-writing og/twitter tags in `layout.html`.
3. **No new field for canonical** — wiki routes are static (unlike Builder's
   dynamic routes); compute canonical from the route.
4. Meta fields are plain Wiki Document fields, saved directly (manager
   action) — they do **not** flow through the Change Request / draft
   revision system.

## Fields (Wiki Document)

New collapsible section **"Meta Tags"** (after the External Link section):

| fieldname          | fieldtype    | label            | notes                                    |
| ------------------ | ------------ | ---------------- | ---------------------------------------- |
| `meta_title`       | Data         | Meta Title       | empty ⇒ falls back to `title`            |
| `meta_description` | Small Text   | Meta Description | description hint: ~150–160 chars         |
| `meta_image`       | Attach Image | Meta Image       | description hint: 1200×630 recommended   |

## Head output (public reader)

Verified framework contract: `templates/includes/meta_block.html` just dumps
the `metatags` dict verbatim (og: keys as `property=`, rest as `name=`). The
og/twitter **expansion** lives in
`frappe.website.website_components.metatags.MetaTags`
(`frappe/website/website_components/metatags.py`): from base keys
`title/description/image` it derives `og:*` + `twitter:*`, sets
`twitter:card` (summary_large_image when image present), absolutizes the
image URL, defaults `og:type=article`, and merges per-route **Website Route
Meta** overrides. Framework invokes it in `base_template_page.py:28-29`;
Wiki's renderer extends `BaseRenderer` and bypasses that, so we call it
ourselves.

`get_web_context()` additions:

```python
from frappe.website.website_components.metatags import MetaTags

context.metatags = {
    "title": self.meta_title or self.title,
    "description": self.meta_description,      # empty ⇒ dropped by MetaTags/meta_block
    "image": self.meta_image,                   # MetaTags absolutizes
    "og:site_name": space_name,
}
context.metatags = MetaTags(self.route, context).tags
```

`layout.html` head additions:
- `{% include "templates/includes/meta_block.html" %}` — consumes
  `metatags`, emits `<meta name="description">`, `og:*`, `twitter:*`.
- `<link rel="canonical" href="{{ canonical_url }}">` with
  `canonical_url = frappe.utils.get_url('/' + route)` from context.
- `<title>` switches to `metatags.title` so meta_title overrides it too.

Out of scope (phase-2 backlog): sitemap.xml per space, TechArticle JSON-LD,
space-level meta defaults (default og image / title suffix), auto-description
from content excerpt, per-page robots field, folding legacy `head_html` into
structured settings.

The generated OG-image endpoint moved out of this backlog and into its own
spec: `specs/generated_meta_images.md`.

### Phase 5 — BreadcrumbList JSON-LD (added 2026-07-03)

Emit a `BreadcrumbList` JSON-LD script in the public page head, built from
the doc's tree ancestors (space root → groups → page). Per Google's
breadcrumb structured-data rules, every item except the last needs an `item`
URL — intermediate tree nodes that don't resolve to a served URL are
dropped from the trail rather than emitted without a link. Structured data
should mirror what the visible reader UI presents. Unit-tested with
temp-revert verification like the metatags block.

## Page Settings dialog (SPA)

- New `frontend/src/components/PageSettings.vue` — frappe-ui `Dialog`
  (`size: 'lg'`), replacing the orphan `WikiDocumentSettings.vue` (delete it).
- Content (single pane, no sidebar for now):
  - Meta Title `FormControl` (placeholder = current page title)
  - Meta Description textarea (with char-count hint)
  - Meta Image upload (`useFileUpload` + `wiki.api.upload_wiki_asset`) with
    remove/replace
  - **Social preview card** (Builder-style): image (fallback none-state),
    route, effective title, clamped description — live-updating
- Trigger: new "Page settings" item (settings icon) in
  `WikiDocumentPanel.vue` `menuOptions`, visible only with write capability
  (same gate as Publish). Draft-only panel (`DraftContributionPanel`) is out
  of scope — meta editing applies to real Wiki Documents.
- Save: `createDocumentResource({ doctype: 'Wiki Document', name })` +
  `setValue.submit({ meta_title, meta_description, meta_image })` on Save
  button (explicit save, not per-keystroke).
- Per repo convention: frontend enumerates doctype fields explicitly — this
  dialog is the frontend counterpart of the three new backend fields.

## Plan (tracer bullets)

### Phase 1 — Schema + head emission (backend tracer)
- Add the 3 fields to `wiki_document.json` (+ controller type hints).
- `get_web_context()`: build `context.metatags` + `canonical_url`.
- `layout.html`: include `meta_block.html`, canonical link, title from
  metatags.
- Verify: set values via desk on one page, `curl -s <page> | grep -E
  'og:|twitter:|description|canonical'`; also verify fallback page (no meta
  values) emits title-only tags without empty/broken tags.

### Phase 2 — Page Settings dialog (text fields)
- `PageSettings.vue` with meta title/description, save, toast on success.
- Dropdown trigger in `WikiDocumentPanel.vue`; delete orphan
  `WikiDocumentSettings.vue`.
- `yarn build` from `frontend/`; verify in browser end-to-end (edit → save →
  reload public page → tags changed).

### Phase 3 — Meta image + social preview card
- Upload/replace/remove image; preview card live-updates from form state.

### Phase 4 — Tests + polish
- Unit test: `get_web_context` metatags fallbacks (meta_title empty ⇒ title;
  empty description/image omitted) + rendered head contains og/twitter/
  canonical for a published doc. Temp-revert Phase-1 emission to confirm the
  test fails, then restore.
- e2e (playwright): open Page Settings from dropdown, set meta fields, save,
  assert public HTML head.
- Reconcile this spec, log progress.

## Progress

- 2026-07-03: Audited current state (agents), studied Builder, decided
  placement + approach, spec committed.
- 2026-07-03: Phase 1 done — fields + `context.metatags` via framework
  `MetaTags` + `meta_block.html` include + canonical; verified via curl with
  and without meta values set.
- 2026-07-03: Phase 2 done — `PageSettings.vue` dialog (meta title +
  description), "Page settings" item in the page-header dropdown, orphan
  `WikiDocumentSettings.vue` deleted.
- 2026-07-03: Phase 3 done — meta image upload (`upload_wiki_asset`, WebP)
  with Replace/Remove, live social preview card; dialog bumped to `2xl`
  two-column. End-to-end verified in browser: save → public page emits
  `og:*`, `twitter:*` (summary_large_image with image), description,
  canonical, `og:site_name`; dialog reloads saved values, Save disabled when
  clean. Test values cleaned up afterwards.
- 2026-07-03: Phase 4 (backend unit tests) done — added to
  `wiki/frappe_wiki/doctype/wiki_document/test_wiki_document.py`:
  `TestGetWebContextMetaTags` (explicit meta fields → metatags/canonical_url;
  fallback to title/no description/no image/`twitter:card=summary`) and
  `TestRenderedPageMetaTags` (renders the real public route via the werkzeug
  test client, asserts `og:title` and `<link rel="canonical">` appear for a
  published doc with meta fields set, and that `og:image` is absent /
  `twitter:card=summary` for a doc with no meta fields). All 4 new tests plus
  the pre-existing 27 in the module pass. Temp-revert check: commented out
  the `context.metatags`/`canonical_url` block in `get_web_context()` →
  all 4 new tests failed (2 KeyError-style errors, 2 assertion failures on
  the new tests only, rest of module unaffected) → restored via
  `git checkout`, confirmed `git diff` on `wiki_document.py` is empty and the
  full module passes again.
- 2026-07-03: Phase 4 (e2e) done — `e2e/tests/page-settings-meta.spec.ts`:
  opens Page Settings from the page-header "More actions" dropdown, asserts
  Save is disabled until dirty, saves meta title/description, reopens the
  dialog to confirm persistence, then verifies the public page head via a
  real navigation (`og:title`, `meta[name=description]`,
  `link[rel=canonical]`), and clears both fields to confirm the fallback to
  the page title and that the empty description tag is dropped rather than
  emitted empty. Ran in isolation (`page-settings-meta.spec.ts` only, per
  project convention — the full suite floods the local job queue) three
  times in a row, all green. Test space/pages parented directly under the
  space's auto-created `root_group` (not a second manually-created one) so
  `cleanupWikiSpacesByRoute`'s on-trash cascade delete — which resolves
  `wiki_space` by walking the tree up to the space's `root_group` — actually
  catches them; an earlier draft that created its own root group and
  reassigned `Wiki Space.root_group` to it silently orphaned documents on
  cleanup (caught by checking `frappe.db.get_all` after the run showed a
  leftover `Wiki Document`). Image-upload coverage intentionally left out
  (optional per scope; text-field coverage already exercises the dialog's
  save/persist/render path end to end).
- 2026-07-03: Phase 5 done — BreadcrumbList JSON-LD in the public head.
  Trail is [space, page]: sidebar groups are non-clickable toggles with no
  served URL, so intermediate groups are dropped per Google's item-URL rule;
  the space item links the space root route, which 301s to the space's
  default page (verified live). `json.dumps` output escapes `<` as unicode escape (`\u003c`)
  so hostile titles can't close the embedding `<script>` element
  (regression-tested with an in-memory hostile title, since Frappe's
  save-time sanitization already strips tags from stored Data fields).
  4 new tests (2 context-level, 1 rendered + parse, 1 escape), temp-revert
  verified: 3 fail with emission stubbed, restore → module green (35+41).
  Live JSON-LD verified parseable on a real nested page.
