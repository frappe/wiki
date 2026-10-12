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

### Phase 4: Space PDF Download Control & Guest Permission Gating
1. **DocType Field**: Added `allow_pdf_download` (Check, default 1) to `Wiki Space` schema (`wiki_space.json`).
2. **Frontend Settings**: Added "Allow PDF Download" toggle to `frontend/src/components/SpaceSettings/AccessPanel.vue`, synced with the backend API `set_space_pdf_download`.
3. **Reader Gating Fix**: Gated all PDF download actions (`downloadPage`, `downloadSpace`, `downloadSpaceMergedPdf`) behind `can_download_pdf` (`allow_pdf_download or can_write`) in `templates/wiki/document.html`. Resolved bug where `can_edit` evaluated to `True` for guests when `allow_contributions` was enabled.
4. **Backend Security**: Enforced `_assert_pdf_download_allowed` in `download_pdf`, `download_bulk_pdf`, and `download_merged_pdf` to block unauthenticated guest downloads when the space toggle is off.

### Phase 5: Single Merged PDF Download for Space and Groups
1. **Merged PDF Endpoint**: Added `@frappe.whitelist(allow_guest=True) def download_merged_pdf(route: str)` using `pypdf` (`PdfWriter` and `PdfReader`). Concatenates all published leaf page PDFs into a single merged PDF file in tree order.
2. **Bulk Endpoint Support**: Updated `download_bulk_pdf(route, format)` to delegate to `download_merged_pdf` when `format="merged_pdf"`.
3. **Public Reader UI**:
   - Added `download_space_merged_pdf_action_item` macro in `templates/wiki/macros/buttons.html`.
   - Added `downloadSpaceMergedPdf()` Alpine method in `templates/wiki/document.html`.
4. **Workspace SPA UI**:
   - Added "Download Space (Merged PDF)" action in `frontend/src/components/SpaceSidebar.vue`.
   - Added "Download Merged PDF" action to group menus in `frontend/src/components/WikiTree.vue`, handled in `WikiDocumentList.vue`.
   - Built frontend assets via `npm run build`.

### Phase 6: Print Format Optimization (Eliminating Trailing Blank Page)
1. **Print Template**: Removed redundant `<div class="page-break">` root wrapper from `wiki/frappe_wiki/print_format/standard_wiki_document/standard_wiki_document.html`.
2. **Page Count Verification**: Confirmed single-page documents render to exactly 1 page instead of 2 with an empty trailing page, and merged multi-document PDFs no longer append alternating blank pages.

## 4. Testing & Verification Status
- **Backend Unit Tests**:
  - `TestPDFDownloadSetting.test_allow_pdf_download_toggle_and_gating`: Verifies toggle updates, guest web context gating, API PermissionError rejection when disabled, and writer bypass.
  - `TestWikiDocumentBulkPdfDownload.test_bulk_pdf_generates_valid_zip`: Verifies zip archive generation with nested hierarchy.
  - `TestWikiDocumentBulkPdfDownload.test_bulk_pdf_generates_valid_merged_pdf`: Verifies single merged PDF generation with `pypdf` page stitching.
  - `TestWikiDocumentPdfDownload.test_standard_wiki_document_print_format_has_no_root_page_break`: Verifies template does not wrap document in `.page-break`.
- **E2E Playwright Tests (`e2e/tests/bulk-pdf-export.spec.ts`)**:
  - Verifies Reader dropdown displays single-page PDF, ZIP, and Merged PDF actions when enabled.
  - Verifies Reader dropdown hides all PDF download actions from Guest when disabled (even with contributions ON).
  - Verifies Manager retains download options when disabled for readers.
  - Verifies Space Settings Access tab surfaces the "Allow PDF Download" toggle.
  - Verifies Space Sidebar menu surfaces both ZIP and Merged PDF download items.
- **Skills Regression**: `python3 -m unittest discover -s skills/frappe-wiki-skill/scripts/tests` passed (26 tests).
- **Live Verification**: Verified HTML output and HTTP responses on local server for both enabled and disabled states.
