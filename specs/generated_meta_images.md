# Auto-generated meta (OG) images

Issue: [frappe/wiki#713](https://github.com/frappe/wiki/issues/713) — "Meta image creator"

## Problem

`Wiki Document.meta_image` is a manual upload. If nobody uploads one, the page ships no `og:image`
at all, and every wiki page looks identical when shared on Slack / X / LinkedIn. We want a branded
card generated from the page's own title, breadcrumb and space branding.

## How Frappe Builder does it

Builder does **not** own a renderer. `builder/html_preview_image.py` POSTs the rendered page HTML to
`preview.frappe.cloud`, which runs the `frappe/preview_generator` app, whose `api.py` is a ~10-line
wrapper around a **framework** util. Builder stores the result at
`sites/<site>/public/files/<page>-preview.webp`, `db_set`s the path with a `?v=<hash>` cache-buster,
and triggers it from a background job on publish. Its `og:image` is `meta_image or preview`.

The interesting part is the framework util, and it already ships in this bench:

`frappe/utils/preview.py` → `get_preview_from_html(html, format="jpg", width=1280, height=720) -> bytes`

- Native headless Chromium over CDP, reusing the **PDF generator's** `ChromiumManager`.
  No Playwright, no Puppeteer, no new dependency, no microservice.
- Sets the tab URL to the host *before* `setContent`, so `/assets/…` and `/files/…` inside our HTML
  resolve from disk — the bundled Inter font and space logos load.
- Formats: `jpg` / `jpeg` / `webp` only (no PNG). We use **jpg**.
- Deliberately **not** whitelisted (rendering arbitrary HTML server-side is an SSRF surface), so it
  must be called in-process with HTML we control.

We skip the microservice hop and call the util directly. Serving stays **lazy** — the `og:image` URL
is always valid and the first request renders — but we borrow Builder's precompute idea as a
*warm-up*: a background job regenerates the card on the same document-write events that already
clear caches and re-index search, so in practice the first crawler hit is a cache hit. The warm-up
can never break the page, because the lazy path is still the one serving bytes. Bulk pre-generation
of an existing wiki is out of scope.

## Decisions

| | |
|---|---|
| Serving | `og:image` → whitelisted `allow_guest` endpoint. Cold hit renders + writes a jpg under `private/files/wiki-og/`; warm hits stream that file. |
| Card content | space logo, breadcrumb trail, page title, space name |
| Rollout | `Wiki Settings.auto_generate_meta_images` checkbox, default **ON** |
| Template | hardcoded HTML/CSS, not user-configurable yet; colours and type come from **frappe-ui design tokens** |
| Freshness | lazy on first request, plus a **warm-up job on write** (merge / desk / git sync) so the first crawler after a change is already warm |
| Size | 1200 × 630, jpg |

### Why not the alternatives

- **Redis bytes.** A 1200×630 jpg is 60–150 KB; a 5k-page wiki is ~0.5 GB in a cache meant to be
  disposable. `bench clear-cache` is routine during deploys and would hand the next crawler wave a
  full regeneration storm. Redis is used only for the generation *lock* and the *negative* marker —
  both tiny and genuinely disposable.
- **Builder's write-then-point-at-`/files/`.** Requires the file to exist *before* the URL is
  emitted, i.e. precompute on publish. Ruled out; a cold page would emit an `og:image` that 404s.
- **Hybrid (chosen).** First hit pays the screenshot, every later hit is an `open()` + `read()`.
  Durable across `clear-cache` and restarts, self-pruning by fingerprint, and needs **no DB write on
  a GET** — freshness lives in the filename, not a `db_set` — so it is safe under maintenance mode.
  The one cost over static serving is that bytes flow through a gunicorn worker instead of nginx.
  For a docs site that is a rounding error next to the page render, and it buys correct 404s for
  gated pages instead of leaking a permissioned space's card via a guessable static path.

## Cache key scheme

Fingerprint every input the template consumes, and nothing else:

```
fp   = sha256("\x1f".join([TEMPLATE_VERSION, title, breadcrumb_trail,
                           space_name or "", logo_url or "", str(W), str(H)])).hexdigest()[:12]

path      = <site>/private/files/wiki-og/<doc_key>-<fp>.jpg
lock key  = wiki_og_lock:<doc_key>:<fp>     (SET nx ex=90)
fail key  = wiki_og_fail:<doc_key>:<fp>     (ttl 600)
og:image  = /api/method/wiki.api.og_image.og_image?route=<route>&v=<fp>
```

Fingerprinting the *inputs* rather than `modified` means a content-only edit does not orphan a still
correct image, while a title / breadcrumb / space-name / logo change invalidates automatically — no
invalidation hook needed anywhere. `TEMPLATE_VERSION` is a module constant, bumped whenever the
hardcoded template changes; that is the migration story for template edits. `doc_key` is immutable,
so a rename or move keeps the same file family.

`&v=<fp>` is a pure cache-buster for scrapers and CDNs. The endpoint recomputes `fp` server-side and
**ignores the param for lookup**, so a stale `v` still serves the current image rather than 404ing,
and a crafted `v` cannot poison the cache directory.

## Phases

Tracer-bullet slices, commit per phase. Branch `feat/generated-meta-images` off `upstream/develop`
(`git fetch upstream develop` first). This spec is committed before any code, per `CLAUDE.md`.

### Phase 0 — spec

Commit this file. Strike the backlog line at `specs/page_settings_meta_fields.md:116-119`, which
already describes this feature ("the tailwindcss.com pattern: `og:image = /api/og?path=…`").

### Phase 1 — tracer bullet: HTML → image → HTTP

Nothing wired into the page yet; verified by hitting the URL directly.

**New `wiki/api/og_image.py`** (alongside `wiki/api/github.py`, `wiki/api/wiki_space.py`):

- `TEMPLATE_VERSION = "1"`, `OG_WIDTH = 1200`, `OG_HEIGHT = 630`
- `_resolve_doc(route)` — `frappe.db.get_value("Wiki Document", {"route": route, "is_group": 0,
  "is_external_link": 0}, "name")`, then `frappe.get_cached_doc`, then `doc.check_space_access("read")`
  + `doc.check_published()`. Exactly the `download_pdf` preamble (`wiki_document.py:840`); both raise
  `DoesNotExistError`, so restricted pages 404 rather than 403.
- `_og_context(doc)` — `{title, breadcrumbs, space_name, logo_url}`. Breadcrumb names reuse the
  existing `get_ancestors()` / `get_breadcrumbs()` shape (`wiki_document.py:350`): ancestor titles
  minus the root group, capped at 2 segments, ellipsized.
  `logo_url` comes from the space's `light_mode_logo` through `_safe_asset_url()` — accept only
  `/files/…` or `/assets/…`, drop anything else, including `/private/files/…` (Chromium can't read it)
  and remote URLs (would be an outbound fetch from the renderer).
- `render_og_html(ctx)` — `frappe.render_template("templates/wiki/og_image.html", ctx)`.
- `generate_og_bytes(doc)` — `get_preview_from_html(html, format="jpg", width=1200, height=630)`.
- `og_image(route, v=None)` — `@frappe.whitelist(allow_guest=True)` with the
  `# nosemgrep: frappe-semgrep-rules.rules.security.guest-whitelisted-method` comment the other guest
  endpoints carry.

**Returning the image.** A whitelisted method may return a raw `werkzeug.wrappers.Response` —
`frappe/handler.py:58` passes it straight through. That gives full control of `Content-Type`,
`Cache-Control` and `ETag`, and avoids `as_raw()`'s `Content-Disposition: attachment`, which would
break `og:image`. Do **not** use `frappe.local.response.filecontent` here. Precedent for a raw
Response in this app: the `text/markdown` branch of `WikiDocumentRenderer.render()`
(`wiki_document.py:584-591`).

**`frappe.render_template` does not autoescape.** `FrappeSandboxedEnvironment`
(`frappe/utils/jinja.py:66`) is constructed without `autoescape=True`. Every interpolation in the OG
template must use `| e`, or a page titled `"><img src=http://evil/x>` turns the screenshotter into an
SSRF / exfiltration vector. This is the single biggest security note in this spec.

**New `wiki/templates/wiki/og_image.html`** — self-contained, inline `<style>`, no dependency on the
Tailwind build (`wiki.css` is purged against reader markup, not this):

- `@font-face` for `Inter` at `/assets/wiki/fonts/Inter.var.woff2` (confirmed present), with
  `font-family: Inter, ui-sans-serif, system-ui, sans-serif` so a font-load failure degrades rather
  than breaks.
- `body` fixed at `1200x630`, `box-sizing: border-box`, `padding: 72px`, flex column,
  `justify-content: space-between`. 12px accent bar pinned to the top.
- Top: `<img class="logo">` (132px tall, max-width 520px, `object-fit: contain`), rendered only when
  `logo_url` survived validation.
- Middle: breadcrumb trail, muted, small (`Guides / Integrations`), then the title — 600 weight,
  `-0.02em` tracking, `-webkit-line-clamp: 3`. Font size is picked **in Python** by title length
  (≤40 chars → 76px, ≤80 → 60px, else 48px) so nothing depends on script execution before capture.
- Bottom: `space_name` at 28px.

#### Colours and type come from frappe-ui tokens

The card is a product surface; it should not invent its own greys. Source of truth is the
Figma-synced token set that ships with frappe-ui (`1.0.0-beta.25`):

```
frontend/node_modules/frappe-ui/tailwind/generated/colors.json
  → themedVariables.light.<group>.<name>  ("ink/gray-9" → "lightMode/gray/950")
  → lightMode.gray.950                    ("#0f0f0f")
frontend/node_modules/frappe-ui/tailwind/generated/typography.json  (weights, tracking)
```

We cannot *load* the built stylesheet here: the SPA bundle is purged, lives under a content-hashed
filename, and carries dark-mode variables — none of which a deterministic screenshot wants. So the
template inlines a `:root { … }` block holding the resolved **light-mode** values under their real
token names, and every rule references `var(--ink-gray-9)` rather than a raw hex. The card is always
light: no `prefers-color-scheme`, no `data-theme`.

| var | token ref | value | use |
|---|---|---|---|
| `--ink-gray-9` | `lightMode/gray/950` | `#0f0f0f` | title |
| `--ink-gray-7` | `lightMode/gray/800` | `#383838` | space name |
| `--ink-gray-5` | `lightMode/gray/600` | `#7c7c7c` | breadcrumb |
| `--outline-gray-2` | `lightMode/gray/300` | `#e2e2e2` | hairline / separator |
| `--surface-gray-2` | `lightMode/gray/100` | `#f3f3f3` | accent bar, until the Phase 5 space accent lands |
| `--surface-white` | — | `#ffffff` | background; resolve the exact key at implementation time, the group may carry no `white` entry |

Regenerate the block with:

```py
import json, functools
d = json.load(open("frontend/node_modules/frappe-ui/tailwind/generated/colors.json"))
res = lambda ref: functools.reduce(lambda c, k: c[k], ref.split("/"), d)
res(d["themedVariables"]["light"]["ink"]["gray-9"])   # '#0f0f0f'
```

The three title sizes stay literal — the token scale stops far below card scale — but weight and
tracking come from `typography.json`. `TEMPLATE_VERSION` is bumped whenever the token block changes,
which invalidates every cached card for free.

Verify: `curl -o /tmp/og.jpg 'http://wiki.localhost:8000/api/method/wiki.api.og_image.og_image?route=<route>'`

### Phase 2 — disk cache, headers, pruning

In `wiki/api/og_image.py`:

- `_cache_dir()` → `frappe.get_site_path("public", "files", "wiki-og")`, `os.makedirs(exist_ok=True)`.
- `og_fingerprint(ctx)` and `_cache_path(doc_key, fp)` per the scheme above.
- `_write_cached(path, data)` — write to `path + ".tmp-<random>"` then `os.replace`. Atomic;
  concurrent writers cannot produce a torn read.
- `_prune_old(doc_key, keep_fp)` — `glob("<doc_key>-*.jpg")`, unlink the rest. Called after each
  successful write, so the directory holds exactly one file per document.
- Headers: `Cache-Control: private, max-age=300, stale-while-revalidate=10800`, `ETag: "<fp>"`,
  and a `304` when `If-None-Match` matches.
  `process_response` (`frappe/app.py:258`) uses `setdefault` for `Cache-Control`, so our value wins.
  Note `frappe._dev_server` force-overrides to no-cache in dev.

  **Revised during review — this originally said `public, max-age=86400,
  stale-while-revalidate=604800`.** That is more permissive than frappe serves
  the wiki page itself (`private,max-age=300,stale-while-revalidate=10800`, in
  `frappe/website/utils.py`'s `cache_html`), and the card URL carries no
  identity: a shared cache would go on serving a card for a day — a week
  stale — after the page was unpublished or the space's roles changed, with no
  request reaching `_resolve_doc` again. Matching the page's own policy means a
  card is never cacheable for longer, or by more parties, than the page whose
  title it shows. The cost is losing CDN offload, which for one image per
  shared link is a rounding error.
- Extend `on_wiki_document_trash` in `wiki_document.py` to drop `wiki-og/<doc_key>-*.jpg`, deferred
  via `frappe.db.after_commit` like `_drop_from_search_index_on_unpublish` (`:881`), so a rollback
  does not delete live files.

### Phase 3 — wire into meta tags

In `WikiDocument.get_web_context()` (`wiki_document.py:426-436`):

- Add `WikiDocument.get_og_image_url()` — returns `None` unless `is_published and not is_group and
  not is_external_link`, the doc has a resolvable space, and the Wiki Settings toggle is on
  (read via `frappe.get_cached_value`, since this runs on every page render). Otherwise builds
  `/api/method/wiki.api.og_image.og_image?route={quote(route)}&v={fp}`.
  Return a **path**, not an absolute URL, so `MetaTags.init_metatags_from_context`
  (`frappe/website/website_components/metatags.py:26`) absolutizes it through `get_url()` — that is
  what keeps it correct on custom domains.
- `metatags["image"] = self.meta_image or self.get_og_image_url()` — an explicit upload keeps winning.
- Add `og:image:width` / `og:image:height` / `og:image:type`. These pass through `MetaTags` untouched
  (not in its `METATAGS` tuple) and `meta_block.html` emits any `og:`-prefixed key as a `property`,
  so no framework change is needed.
- `twitter:card` flips to `summary_large_image` on its own once an image is present.

**Settings toggle.** Add `auto_generate_meta_images` (Check, `default: "1"`) to
`wiki/wiki/doctype/wiki_settings/wiki_settings.json`, next to `auto_convert_images_to_webp`
(fieldname list line 13, field def line 74). Per the frontend/backend sync convention in `CLAUDE.md`,
add the matching `<SettingToggle fieldname="auto_generate_meta_images" …/>` to
`frontend/src/components/WikiSettings/GeneralPanel.vue`, then `yarn build` in `frontend/`.
With the toggle off, `get_og_image_url()` returns `None` and the emitted HTML is byte-identical to
today's.

**Warm-up on write.** The app already does post-write work on document events — `_clear_stale_website_cache`
drops the website cache (`wiki_document.py:993`) and merges queue a search re-index. Card generation
belongs in exactly that company.

No merge-specific code is needed, because of how the merge classifies changes: `_classify_changes`
(`wiki_change_request.py:1905-1917`) counts `title`, `slug`, `route`, `parent_key` and `is_published`
as `metadata_fields`, so every change that moves the OG fingerprint is **structural** and merges
through a full `doc.save()` — which fires `on_update`. The content-only fast path does bypass hooks
(raw `db.set_value`, `wiki_change_request.py:2004`), but content is not in the fingerprint, so nothing
is missed there. One hook therefore covers merges, desk edits and git sync alike.

- `enqueue_og_warmup(doc)` in `wiki/api/og_image.py`, called from `on_wiki_document_update`
  (`wiki_document.py:938`) right beside the existing cache clear.
  - Bail on: settings toggle off, `is_group`, `is_external_link`, not `is_published`, no space.
  - Diff the fingerprint inputs against `doc.get_doc_before_save()` — the same shape
    `_clear_stale_website_cache` uses — and enqueue only when the fingerprint actually moved or the
    cached file is missing.
  - `frappe.enqueue("wiki.api.og_image.warm_og_image", name=doc.name, queue="short",
    job_id=f"wiki-og-{doc.name}", deduplicate=True, enqueue_after_commit=True)`. `after_commit` so a
    rolled-back merge never renders; `deduplicate` so a multi-touch merge collapses per document.
- `warm_og_image(name)` — resolve doc → ctx → fingerprint → path, return early if the file exists,
  else the same `generate_og_bytes` + `_write_cached` + `_prune_old` as the request path, under the
  **same** `wiki_og_lock:` / `wiki_og_fail:` keys so a worker and a crawler never both launch Chromium.

The request path is unchanged and remains the fallback: never-merged documents, pages whose space
name or logo changed (not enumerated per document), and any warm-up that failed. Nothing in the page
render depends on the job.

### Phase 4 — hardening

- **Rate limit.** `@rate_limit(key="route", limit=60, seconds=3600, ip_based=True)`
  (`frappe/rate_limiter.py:104`). Keying on `route` plus IP bounds a single crawler without
  throttling a legitimate crawl across many pages.
- **Thundering herd.** Before generating, `frappe.cache().set(frappe.cache().make_key(lock_key),
  b"1", nx=True, ex=90)`. `RedisWrapper` subclasses `redis.Redis`, so `nx`/`ex` are available, and
  `make_key` keeps it site-scoped. If the lock is not acquired, another worker is already rendering:
  return `503` with `Retry-After: 5` and `Cache-Control: no-store` instead of queueing behind
  Chromium. Crawlers retry; browsers do not care.
- **Failure path.** Wrap generation in `try/except`, `frappe.log_error`, set the `wiki_og_fail:` key
  for 600s, return `404` + `no-store`. Later hits short-circuit on that key without touching
  Chromium. A 404 `og:image` degrades to "no preview image" in every major scraper — and the page
  render is never in this call path, so a broken Chromium can never break a wiki page.

### Phase 5 — branding / configurability (later)

- Space-level accent colour and an explicit space-level default OG image on `Wiki Space` (falling
  back to the generated card). Both feed the fingerprint, so switching them invalidates for free.
  The accent replaces the `--surface-gray-2` bar in the token block.
- A space rename / logo swap moves the fingerprint of every page in that space at once. Today those
  regenerate lazily, one crawler hit at a time; a bounded bulk warm-up (chunked, `queue="long"`)
  could be added behind the same `warm_og_image` seam.

## Tests

**CI has no server-side Chromium** — `.github/workflows/ci.yml` installs none; only `ui-tests.yml`
does, and that is Playwright's own browser. So every Python unit test must patch
`wiki.api.og_image.get_preview_from_html` — **at the point of use**, not at `frappe.utils.preview`,
or the import binding is not replaced.

New `TestOGImageEndpoint(WikiDocumentTestBase)` in
`wiki/frappe_wiki/doctype/wiki_document/test_wiki_document.py`, using the existing `TEST_CLIENT` /
`_make_request` helpers:

- unknown route → 404; unpublished doc → 404; doc in a space with no Guest read role, requested as
  Guest → 404.
- published doc, renderer patched to return `b"\xff\xd8\xff"` → 200, `Content-Type: image/jpeg`.
- `render_og_html` with title `'"><img src=x>'` → the raw `<img` does not appear. Regression guard
  for the autoescape gap; this is the test that stops a future contributor reintroducing it.
- second request with the renderer mocked → `mock.call_count == 1`.
- renaming the doc → new fingerprint, new file, old file pruned.
- `If-None-Match` → 304 with an empty body.

Warm-up (same patched renderer, plus `frappe.enqueue` patched to assert the call):

- merging a CR that renames a page → one job enqueued and, running it, the new-fingerprint file
  lands on disk **without any page view**; the old sibling is pruned.
- a content-only merge → nothing enqueued (content is not a fingerprint input).
- `warm_og_image` with the file already present → the renderer is not called.
- Wiki Settings toggle off → nothing enqueued.

Token drift (no Chromium involved):

- read `frontend/node_modules/frappe-ui/tailwind/generated/colors.json`, `skipTest` when absent (the
  Python CI job installs no frontend dependencies), otherwise assert every var in the template's
  `:root` block equals the resolved light-mode token. Same intent as frappe-ui's own
  `tailwind/audit-token-drift.cjs`. This is what stops the card drifting from the design system.

Existing tests that must change:

- `test_metatags_fall_back_to_title_when_meta_fields_unset` (`:391`) — `og:image` is now present and
  `twitter:card` becomes `summary_large_image`.
- `test_rendered_head_omits_image_tags_when_no_meta_image` (`:457`) — rename to
  `…_uses_generated_og_image_…` and invert; keep a variant asserting the tags stay absent with the
  Wiki Settings toggle **off**.
- `test_metatags_use_explicit_meta_fields_when_set` (`:375`) — should pass untouched; add a sibling
  asserting the URL is *not* the endpoint when `meta_image` is set.
- New: groups, external links and unpublished docs emit no `og:image`.

`e2e/tests/` — load a page, read `meta[property="og:image"]`, fetch it, assert 200 + `image/jpeg`.
This is the only place a real server-side Chromium is exercised, and it is not guaranteed on the CI
site, so gate the assertion on the endpoint not returning 503 rather than hard-failing.
Local runs need `BASE_URL=http://wiki.localhost:8000`.

## Verification

```bash
bench --site wiki.localhost migrate
bench --site wiki.localhost run-tests --app wiki \
  --module wiki.frappe_wiki.doctype.wiki_document.test_wiki_document
cd frontend && yarn build
```

1. Open a published wiki page, view source, confirm `og:image` points at the endpoint with `v=`.
2. Open that URL directly — a 1200×630 jpg card with logo, breadcrumb, title, space name.
3. Confirm `sites/wiki.localhost/private/files/wiki-og/<doc_key>-<fp>.jpg` exists; reload and confirm
   mtime is unchanged (cache hit).
4. Rename the page → new `v`, new file, old sibling pruned.
5. Upload a `meta_image` → `og:image` switches back to the upload.
6. Turn the Wiki Settings toggle off → `og:image` disappears from the head.
7. `curl -A "facebookexternalhit" …` on the page to confirm the card is fetched anonymously.
8. Merge a change request that renames a page, then `ls sites/wiki.localhost/private/files/wiki-og/`
   before opening anything — the new fingerprint file is already there, the old one gone.
9. Eyeball the card against the app: title, breadcrumb and space name should read as the same greys
   the reader uses, not a second palette.

## Status — implemented 2026-07-25 (branch `feat/generated-meta-images`)

Phases 0–4 are done, tested and verified against `wiki.localhost`. Phase 5 stays
future work. Where the code departs from the plan above:

- **`--surface-white` is retired.** frappe-ui's tokens-v2 deliberately drops the
  legacy alias (`tailwind/figma-tokens-to-theme.js:134`) so straggler usage fails
  visibly. The template declares `--surface-base` (`neutral/white`, `#ffffff`)
  instead, and that is the name the drift test asserts.
- **Title tracking is `0em`, not `-0.02em`.** `typography.json` puts every size at
  or above the card's scale on `0em`; the spec's negative value was invented.
  Weight stays `600` (`fontWeight.semibold`).
- **`generate_og_bytes(ctx)` takes the context, not the doc.** The context *is*
  the render input and is what the fingerprint hashes, so passing the doc would
  mean building it twice.
- **The warm-up skips inserts.** A page nobody has shared has no stale card to
  replace, and warming every insert would turn a git-sync import of a whole wiki
  into a Chromium storm — the same bulk pre-generation this spec puts out of
  scope. Renames, publishes and moves (all updates) are covered.
- **A patch turns the setting on for existing sites.** A new Check on a Single
  does not backfill its default, so `auto_generate_meta_images` would read as 0
  everywhere the doctype already existed. `patches.txt` sets it, mirroring the
  `auto_convert_images_to_webp` line above it.
- **The merge warm-up tests live in `test_wiki_change_request.py`**, next to the
  CR fixtures and `_approve_and_merge` they need, rather than in
  `test_wiki_document.py`.
- **No accent bar.** The 12px `--surface-gray-2` bar was dropped during design
  review; the card is a plain white field. `--surface-gray-2` and
  `--outline-gray-2` stay declared in the `:root` block — that block is the
  card's palette, and keeping them there keeps the drift test guarding values
  the Phase 5 space accent will want back.
- **Cards are private-cached and stored under `private/files/`.** Two review
  findings that turned out to be the same mistake: the card was reachable, and
  replayable, without the access check the endpoint performs. Both the
  `Cache-Control` header and the cache directory are corrected above; the
  principle is that a card must never outlive, or out-reach, the authorization
  that produced it.
- **The endpoint honours the settings toggle too**, not just `get_og_image_url()`.
  The spec only turned the *tag* off; a crawler holding an old `og:image` URL
  would still have launched Chromium on a site that disabled cards. The kill
  switch has to actually kill generation.
- **Page Settings previews the real card.** The dialog's Social Preview showed a
  placeholder whenever `meta_image` was empty, which is now wrong — the page does
  ship an image. It points at the live endpoint (so what the box shows is what a
  scraper fetches) and falls back to the placeholder on `@error`, which covers
  every no-card case in one branch instead of duplicating the conditions in JS.
  Saving keeps the dialog open — saving is what regenerates the card, so closing
  would hide the thing that just changed — and bumps a counter in the URL's `v`
  so the browser refetches. Without that bump a preview request that raced the
  save left a stale card on screen for the rest of the session; keying the bump
  to saves rather than keystrokes keeps it to one extra render.

The escaping guard and the token-drift guard were both verified by temporarily
reverting what they protect (dropping `| e` from the title; changing one hex
value) and confirming each test failed.

## Risks

1. **Chromium cold start blocks a worker.** The first `ChromiumManager` spin-up is seconds. The lock
   + `503` keeps it to one worker at a time per page and the rate limiter caps the blast radius.
   Sites with no Chromium at all are covered by the negative cache and the kill switch, but the
   *first* request per fingerprint still pays a failed launch. Accept and monitor.
2. **No autoescape.** Covered by explicit `| e` plus the logo URL allowlist, but it is an easy
   regression for anyone editing the template later. The escaping unit test is the guard.
3. **Font may not load before capture.** `set_content` waits for `networkIdle`, which should cover
   the woff2, but a variable font declared `format('woff2-variations')` in headless Chromium is worth
   eyeballing once. The `system-ui` fallback keeps a failure merely uglier, not broken.
4. **1× rendering.** `capture_screenshot` passes no device-scale factor, so text is captured at
   exactly 1200×630. That is the canonical OG size and fine at 72px type, but softer than a 2×
   render. If it reads poorly the fix is a `Page.set_device_metrics` scale-factor addition upstream
   in frappe, not a wiki change.
5. **Disk cache is per-node.** On a multi-node bench without shared storage each node generates once.
   Bounded and self-healing; a shared byte layer can be added later behind the same
   `_read_cached` / `_write_cached` seam.
6. ~~**`public/files/wiki-og/` is web-readable.**~~ **Resolved during review.** Cards live under
   `private/files/`, which nginx does not serve, so the endpoint's access check is the only way to
   reach one. This also closes the case the original wording missed: under `public/files` a card
   outlived the authorization that produced it, still served statically after the page was
   unpublished or the space's roles changed.
7. **Disk growth.** One ~60–150 KB jpg per published page, with stale siblings pruned on write.
8. **Warm-up job storm.** A structural merge touching N pages enqueues up to N short jobs. Bounded by
   the `job_id` dedupe, the fingerprint diff (unchanged inputs enqueue nothing) and the kill switch —
   but locally this is the same bench queue the git-sync specs already saturate, so keep an eye on it
   during e2e runs. Serving never depends on the job, so a backed-up queue degrades to today's lazy
   behaviour.
9. **Token drift.** The `:root` block is a snapshot of frappe-ui's tokens, not a live import; a
   frappe-ui upgrade can move a value silently. The drift test is the guard, and it self-disables
   where `node_modules` is absent — so it must not be the *only* place the values are checked before
   a release.
