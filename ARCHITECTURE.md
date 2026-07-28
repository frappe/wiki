# Architecture

## Overview
- Backend app lives in `wiki/` (Frappe app, Python).
- Frontend SPA lives in `frontend/` (Vue + Frappe UI) and is shipped to `/assets/wiki/frontend`.

## DocTypes in Use
Source of truth for schema is `wiki/**/doctype/**/**/*.json`.

- Wiki Document (`wiki/frappe_wiki/doctype/wiki_document/wiki_document.json`)
  - Tree doctype for wiki content (groups + pages) with nested ordering.
- Wiki Space (`wiki/wiki/doctype/wiki_space/wiki_space.json`)
  - Top-level space for grouping pages and navigation.
  - Links to a root `Wiki Document` group and controls space branding.
- Wiki Contribution (`wiki/frappe_wiki/doctype/wiki_contribution/wiki_contribution.json`)
  - Draft changes applied to the `Wiki Document` tree (create/edit/move/delete/reorder).
- Wiki Contribution Batch (`wiki/frappe_wiki/doctype/wiki_contribution_batch/wiki_contribution_batch.json`)
  - Approval unit that merges contributions into the live `Wiki Document` tree.
- Wiki Feedback (`wiki/wiki/doctype/wiki_feedback/wiki_feedback.json`)
  - Stores ratings and feedback for a wiki document.
  - Links to `Wiki Document`.

External DocTypes referenced by links:
- `User` (authors/reviewers).
- `Top Bar Item` (navbar config).

## Frontend (Frappe UI)
- SPA is initialized in `frontend/src/main.js` and wrapped by `FrappeUIProvider` in `frontend/src/App.vue`.
- Uses `frappe-ui` resource helpers and UI components across pages and components in `frontend/src/**`.
- The compiled assets are referenced by `wiki/www/wiki-app.html`.

## Public Page Rendering
- Published `Wiki Document` pages are rendered by `WikiDocumentRenderer` in
  `wiki/frappe_wiki/doctype/wiki_document/wiki_document.py` using `templates/wiki/document.html`.
- The renderer uses `Wiki Document.get_web_context` for breadcrumbs, tree navigation, and content HTML.
- `/wiki-app` route uses a Vue SPA entry point:
  - `wiki/www/wiki-app.html` loads `/assets/wiki/frontend/assets/*` and injects boot data.
  - `wiki/www/wiki_app.py` provides the boot context (CSRF token, site info).
