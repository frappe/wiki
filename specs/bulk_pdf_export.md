# Implementation Plan: Bulk PDF Export for Frappe Wiki

## 1. System Analysis & Context
Based on the architecture of the Frappe Wiki app (`ARCHITECTURE.md` and codebase analysis):
- **Backend**: Python-driven (Frappe Framework). Pages are stored in the `Wiki Document` doctype, which acts as a nested tree (groups and leaves). `Wiki Space` is the top-level container linking to a root `Wiki Document`. PDF generation already exists for single pages (`download_pdf` using `get_print` with `wkhtmltopdf`).
- **Frontend**: Vue 3 SPA using `frappe-ui` for logged-in/desk users, and Jinja-rendered HTML (`templates/wiki/document.html`) with Alpine.js for the public-facing guest reader.
- **Permissions**: Read access is checked via `doc.check_space_access("read")`.

## 2. Feature Behavior
**Goal**: Allow users to download an entire Space or a specific group of pages as a ZIP file containing PDFs of all nested pages, maintaining the directory structure.

### API & Logic
- **Endpoint**: A new whitelisted method `download_bulk_pdf(route: str)` in `wiki_document.py` (or a dedicated `export.py`).
- **Execution**:
  1. Determine if the route is a `Wiki Space` or a `Wiki Document` (group).
  2. Perform a `check_space_access("read")` to ensure the user (or guest) is authorized.
  3. Fetch the nested tree of published documents using the existing `get_public_wiki_tree` logic.
  4. Create an in-memory ZIP archive using Python's `zipfile` and `io.BytesIO`.
  5. Traverse the tree recursively. For each published leaf node, generate the PDF using `get_print(..., as_pdf=True)` and write it to the ZIP archive with a path reflecting its tree hierarchy (e.g., `My Space/Getting Started/Installation.pdf`).
  6. Return the ZIP file via `frappe.local.response`, setting the correct `Content-Type` (`application/zip`) and `filename`.

### UI Integration (Frontend)
- **Public Reader (Vanilla JS / Alpine.js)**: 
  - Add a "Download Space" button/icon in the sidebar or header macros (`wiki/wiki/templates/wiki/macros/buttons.html`).
- **Vue App (Workspace)**: 
  - Add a "Download Space as ZIP" option to the Space context menu (e.g., in `SpaceSidebar.vue` or Space dropdowns).
  - Add a "Download Group as ZIP" option to the folder context menu in `WikiTree.vue`.
- **UX Considerations**: Bulk PDF generation is synchronous and can be slow for large spaces. The UI must show a clear loading state (e.g., "Preparing ZIP archive...") and disable the button to prevent multiple clicks. (Alternatively, for massive spaces, it could be pushed to a background job, but for an MVP, a synchronous download with a loading spinner aligns with the existing single-page PDF flow).

## 3. Step-by-Step Implementation

### Phase 1: Backend API Development (Python)
1. In `wiki/frappe_wiki/doctype/wiki_document/wiki_document.py`, add `@frappe.whitelist(allow_guest=True)` method `download_bulk_pdf(route: str)`.
2. Add logic to locate the root `Wiki Document` associated with the route.
3. Validate permissions `doc.check_space_access("read")`.
4. Traverse `get_public_wiki_tree(doc.name)` recursively.
5. Inside the traversal, for each `is_group == 0` node, fetch the document and generate its PDF:
   ```python
   pdf_bytes = get_print("Wiki Document", doc.name, print_format=WIKI_DOCUMENT_PRINT_FORMAT, as_pdf=True)
   zip_file.writestr(f"{current_path}/{doc.title}.pdf", pdf_bytes)
   ```
6. Set `frappe.local.response` variables to trigger a file download for the zip buffer.

### Phase 2: Vue Frontend (Workspace UI)
1. **API Wrapper**: In `frontend/src/helpers/api.js` (or inline), add a `downloadBulkPDF(route)` function that fetches the blob and triggers browser download.
2. **Space Level Export**: Update `SpaceSidebar.vue` (or the top navigation dropdown) to include a "Download Space (PDFs)" item. Bind it to a reactive `isDownloadingBulk` state.
3. **Group Level Export**: Update `WikiTree.vue` node context menu to include "Download Group" for folders. 

### Phase 3: Public Reader (Jinja HTML)
1. In `wiki/templates/wiki/document.html` and `macros/buttons.html`, duplicate the logic for `downloadPage()` to `downloadSpace()`.
2. Update the Alpine component to handle the ZIP download endpoint and toggle a `downloadSpaceInProgress` loading state.

### Phase 4: Testing & Spec Checks
1. **Unit Tests (Backend)**: Add tests to `test_wiki_document.py` to verify:
   - `download_bulk_pdf` returns a valid zip file.
   - The zip file contains the correct number of PDFs.
   - Nested folder paths inside the zip match the tree hierarchy.
   - Unauthorized users (without read access) are thrown a 403 / PermissionError.
2. **Playwright Tests (E2E)**: Add an e2e test in `apps/wiki/e2e/tests/` to verify that clicking the bulk export button triggers the download.
3. **Documentation**: Update any specs if needed (though this is an additive feature).

## 4. Risks & Mitigations
- **Performance/Timeout**: Generating 50+ PDFs sequentially in a single request might trigger web server timeouts (gunicorn/nginx). 
  - *Mitigation for v1*: Keep it synchronous to match existing architecture, but warn the user in the UI. 
  - *Future enhancement*: Implement a background job using `frappe.enqueue`, notify the user when the ZIP is ready via Frappe real-time, and store the file in the `File` doctype.
