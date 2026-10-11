# Wiki Translation Catalog

Date: 2026-10-01
Status: **In progress.** Phases 0 and 1 done. Builds on [crowdin_translation_sync.md](crowdin_translation_sync.md) and replaces the stopgap in PR [#804](https://github.com/frappe/wiki/pull/804).

## Problem

Wiki has no translation catalog of its own. The SPA fetches `wiki.api.get_translations`, which returns `get_all_translations(lang)`: every installed app's strings. Two things follow.

1. **The catalog is big.** For `es` it is 443 KB (129 KB gzipped). It cannot go into the page boot without slowing every load on non-English sites, so it arrives after mount and the UI first paints in English. #804 hides this by making `__()` reactive.
2. **Most of wiki is untranslated anyway.** `bench generate-pot-file --app wiki` finds 871 strings (512 in `frontend/src`). Frappe's catalog covers about 133 of them for `es`, `de`, `fr` and `ar`. Nobody can translate the other 738, because wiki is not on Crowdin (issue [#441](https://github.com/frappe/wiki/issues/441)).

## How Builder does it

Builder ships its own catalog and puts it in the boot. `builder/www/_builder.py`:

```python
def get_boot() -> dict:
    # only Builder's own catalog, the editor never looks up another app's strings
    lang = frappe.local.lang
    messages = get_translations_from_apps(lang, ["builder"])
    messages.update(get_user_translations(lang) or {})
    return {"translated_messages": messages}
```

- Scoped to one app, the catalog is small, so the HTML stays cheap.
- It is on `window` before mount, so `__()` needs no reactivity and there is no flash of English.
- `ensureTranslations()` in `frontend/src/translation.ts` fetches `frappe.translate.get_boot_translations` before mount, but only when there is no boot. That only happens on the Vite dev server, because the `jinjaBootData` plugin renders the boot only into the built HTML.
- `builder/locale/*.po` comes from Crowdin, configured by `crowdin.yml` and a weekly `generate-pot-file.yml` workflow. LMS uses the same setup.

## Goal

Wiki owns `wiki/locale/main.pot` and one `<lang>.po` per language. The SPA gets a wiki-only catalog in the boot, translated on first paint, with no extra request. Community translators can fill in the rest on Crowdin.

## Non-goals

- Translating content (pages, spaces). This is UI strings only.
- Changing how `__()` handles placeholders or context. Only where the catalog comes from changes.

## Design

### 1. Extraction

`bench generate-pot-file --app wiki` already works. Frappe's `babel_extractors.csv` covers `**.py`, `**.js`, `**.vue` and `**.html`, and wiki has no `.ts` sources, so wiki needs no `babel_extractors.csv` of its own.

Do **not** set the `ignore_translatable_strings_from = ["frappe"]` hook. It would drop the strings wiki shares with frappe (`Save`, `Cancel`, `Settings` and so on) from wiki's POT. The runtime catalog is wiki only, so wiki must carry those strings itself.

### 2. Crowdin pipe

Exactly as in [crowdin_translation_sync.md](crowdin_translation_sync.md): `crowdin.yml`, `.github/workflows/generate-pot-file.yml`, `.github/helper/update_pot_file.sh`, all copied from LMS with `lms` changed to `wiki`. Nothing new here. LMS's real `crowdin.yml` has only `preserve_hierarchy` and `files`, so wiki copies that and not the longer version in the older spec.

### 3. Seed `.po` files from frappe

Before the runtime goes wiki only, the 133 or so strings that frappe already translates must exist in wiki's `.po` files. Otherwise they go back to English on the day we switch.

Run a one-off script for each locale frappe ships (`frappe.gettext.translate.get_locales("frappe")`):

```python
from frappe.gettext.translate import get_catalog, get_locales, write_catalog

for locale in get_locales("frappe"):
    source = get_catalog("frappe", locale)
    seeded = get_catalog("wiki")  # fresh POT copy, same as frappe's new_po()
    seeded.locale = locale
    for message in seeded:
        if not message.id:
            continue
        match = source.get(message.id, context=message.context)
        if match and match.string:
            message.string = match.string
    write_catalog("wiki", seeded, locale)
```

Then `bench compile-po-to-mo --app wiki` (or `bench build`, which compiles too, see `frappe/commands/utils.py:100`) and commit the `.po` files. Do not commit the script: it runs once and its output is the record. Crowdin imports these as existing translations on first sync, so translators start from them.

### 4. Boot the catalog

`wiki/www/wiki_app.py`, in `get_boot()`:

```python
from frappe.translate import get_translations_from_apps, get_user_translations

def get_translated_messages() -> dict:
    lang = frappe.local.lang
    messages = get_translations_from_apps(lang, ["wiki"])
    messages.update(get_user_translations(lang) or {})
    return messages
```

and add `"translated_messages": get_translated_messages()` to the boot dict. `wiki-app.html` already writes every boot key onto `window`.

`frappe.local.lang` follows frappe's own order: the user's language when logged in, then the cookie and `Accept-Language` for guests, then System Settings. Today's API reads `User.language` or System Settings directly, so guests now get their browser language as well. That is an improvement and needs no special handling.

`get_user_translations` keeps site-level `Translation` records working, which today's API also honors through `get_all_translations`.

### 5. Frontend

`frontend/src/translation.js`:

- Read `window.translated_messages` instead of `window.translatedMessages`.
- Drop `createResource` and the post-mount fetch.
- Add a dev-only fallback like Builder's `ensureTranslations()`: when `window.translated_messages` is undefined (Vite dev server), fetch the catalog and await it before `app.mount()` in `main.js`. This path never runs in production, so blocking is fine. Point it at a whitelisted wiki method that returns `get_translated_messages()`, so dev sees the same scoped catalog as production.
- If #804 has merged, remove its `shallowRef`. A catalog that exists before mount needs no reactivity.

Remove `wiki.api.get_translations`. Search for other callers first. Today there are none outside `translation.js`.

## Size budget

Measured for `es` after phase 0: 136 strings, 3.6 KB raw, 1.5 KB gzipped in the boot. Today's API returns 443 KB (129 KB gzipped). Even fully translated, 898 strings stay far under the 30 KB gzipped limit.

`get_translations_from_apps` reads wiki's `.mo` on every page load without a cache. Builder does the same. The file is small, so this is fine.

## Phases

Tracer bullet first: one language through every layer, then widen.

### Phase 0: tracer (`es` only)

- Generate `wiki/locale/main.pot`.
- Seed only `wiki/locale/es.po` with the script in step 3. Compile.
- Boot the wiki-only catalog (step 4) and switch `translation.js` to read it (step 5, without removing the API yet).
- Verify on `wiki.localhost` with Administrator's language set to `es`: the sidebar and header are in Spanish on first paint, and the network tab shows no translation request.
- Measure the boot size and fill in the size budget.

### Phase 1: all locales and the Crowdin pipe

- Seed every frappe locale.
- Add the Crowdin files from [crowdin_translation_sync.md](crowdin_translation_sync.md).

### Phase 2: cleanup and tests

- Remove `wiki.api.get_translations` and the post-mount fetch.
- Add the dev-server fallback.
- Unit test (`wiki/www/test_wiki_app.py` or next to existing boot tests): with a `Translation` record for `es`, `get_translated_messages()` includes it, and it does not include a string that only another app translates. Verify it fails with the fix temporarily reverted.
- E2E (`e2e/tests/translations.spec.ts`): set the user's language to `es`, load `/wiki-app`, assert the sidebar shows the translated label on first paint, and assert no request to a translations endpoint was made.

### Phase 3: maintainer steps (outside the repo)

From [crowdin_translation_sync.md](crowdin_translation_sync.md), done by a frappe org maintainer:

1. Create the Crowdin project and target languages.
2. Authorize the Crowdin GitHub app on `frappe/wiki`, branch `develop`. Enable importing existing translations so the seeded `.po` files are picked up.
3. Create the `translation` label.
4. Add the `RELEASE_TOKEN` secret.

Phases 0 to 2 do not depend on phase 3. The seeded catalog works without Crowdin. Crowdin only adds new translations over time.

## Open questions

- Should #804 merge first as a stopgap? It fixes the mixed-language UI today, and phase 2 removes it. Merging it costs nothing if this work takes more than a release.
- Public reader pages are server-rendered and use `frappe._`, which already searches every app's `.mo`. They get better coverage from wiki's catalog for free. Check that nothing there relied on `wiki.api.get_translations`.

## Branch / PR

- Branch `feat/wiki-translation-catalog` off `upstream/develop`.
- Commit this spec first, then one commit per phase.
- PR to `frappe/wiki` `develop`.

## Progress log

- 2026-10-01: Spec drafted. Trial `generate-pot-file` run found 871 strings, about 133 covered by frappe for `es`.
- 2026-10-11: Phase 0 done. POT has 898 strings. Seeding `es` from frappe filled 136. Boot carries `translated_messages`, `translation.js` reads it. On `wiki.localhost` with Administrator in `es`, the sidebar shows "Resumen" and "Buscar" on first paint and no translation request is made. The post-mount fetch still exists as the fallback for the Vite dev server, which renders no boot.
- 2026-10-11: Phase 1 done. Seeded 36 locales, 92 to 147 strings each (`ko` only 3). Skipped `uk`, `bg`, `km` and `ro`: frappe's own `.po` files for them have no translations, so wiki's would be bare POT copies. Crowdin creates them once someone translates. Added `crowdin.yml`, `generate-pot-file.yml` and `update_pot_file.sh` from LMS.
