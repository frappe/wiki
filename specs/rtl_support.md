# RTL support

Issue: [frappe/wiki#848](https://github.com/frappe/wiki/issues/848). Related: [frappe/wiki#825](https://github.com/frappe/wiki/issues/825).

## Why?

Wiki is always left to right. Every page ships `<html lang="en">` with no `dir`, so an Arabic, Persian, Hebrew or Urdu reader sees translated buttons inside a mirrored-wrong layout: text starts on the left, list bullets and the quote bar sit on the left, and the sidebar is on the wrong side.

## What?

When the request language is right to left, both the public reader and the Wiki app render right to left.

- `<html>` carries the real language and `dir`, on the public reader and the SPA.
- Layout mirrors: sidebar, table of contents, header, search, dropdowns, buttons, arrows.
- Code blocks stay left to right.
- The SPA loads translations for the same language it renders in.

Out of scope, for later slices:

- A page or space language that sets direction on its own (an Arabic page inside an English UI).
- Per block `dir="auto"` for mixed-language content.
- A site setting to force LTR or RTL, like `LMS Settings.text_direction`.
- Translated page versions (#825).

## How?

Prior art: Helpdesk and LMS set `<html dir>` from Frappe's `is_rtl()`. We do the same.

### Language source

`frappe.local.lang` is the one source. Frappe sets it per request: the user's language when logged in, and for guests the `_lang` param, the `preferred_language` cookie or `Accept-Language`, then System Settings. The reader's `_()` strings already use it.

- Reader (`templates/wiki/layout.html`): `<html lang="{{ frappe.lang }}" dir="{{ 'rtl' if is_rtl() else 'ltr' }}">`.
- SPA (`frontend/index.html`): same attributes. `get_boot()` adds `lang`.
- `wiki.api.get_translations` uses `frappe.local.lang`. Today it reads `User.language`, which is empty for users who follow the system language, so they get no translations at all.

### SPA

- Wrap the app in reka-ui's `ConfigProvider` with `dir` from `<html dir>`. frappe-ui's `ScrollArea` and other reka components default to `ltr` without it, which keeps editor content LTR inside an RTL page.
- Replace physical Tailwind classes (`ml-`, `pl-`, `left-`, `border-l`, `text-left`, ...) with logical ones (`ms-`, `ps-`, `start-`, `border-s`, `text-start`). Flip directional icons with `rtl:rotate-180` / `rtl:-scale-x-100`.

### Reader

- Same class swap in `templates/wiki/**`.
- Physical properties in `main.css` and `wiki-rendered.css` become logical (`padding-inline-start`, `inset-inline-end`, ...). Prose CSS from frappe-ui is already logical.
- `pre` gets `direction: ltr` in both the reader and the editor.

## Phases

1. Language and direction on `<html>` for the reader and SPA, translations from `frappe.local.lang`. Python tests.
2. Reader layout mirrors correctly in RTL.
3. SPA layout mirrors correctly in RTL, `ConfigProvider`.
4. E2E: Arabic user sees RTL reader and SPA; English user still sees LTR.

## Progress

- [ ] Phase 1
- [ ] Phase 2
- [ ] Phase 3
- [ ] Phase 4
