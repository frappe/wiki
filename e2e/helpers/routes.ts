/**
 * The editor SPA's base path, in one place.
 *
 * Renaming the app's route used to mean touching ~35 spec files. Everything
 * here builds off APP_BASE, so a future rename is a one-line change on the
 * test side.
 *
 * Kept in sync with the two other definitions of this route — there is no
 * automatic mechanism, same as GENERAL_KEY / WIKI_HOME_TAB_KEY:
 *   - `createWebHistory()` in frontend/src/router.js
 *   - `APP_ROUTE` in wiki/frappe_wiki/doctype/wiki_document/wiki_document.py
 */
export const APP_BASE = '/wiki-app';

/**
 * Build a path inside the app.
 *
 * A trailing query string rides along on the last segment:
 * `appUrl('change-requests?tab=all')`.
 */
export function appUrl(...segments: string[]): string {
	return [APP_BASE, ...segments].join('/');
}

/**
 * Selector for a link into a space. Without an id it matches *any* space link —
 * the "click the first space" idiom most specs open with.
 */
export function spaceLinkSelector(spaceId?: string): string {
	return spaceId
		? `a[href="${appUrl('spaces', spaceId)}"]`
		: `a[href*="${appUrl('spaces')}/"]`;
}

/** Matches a URL sitting on some space — for `toHaveURL`. */
export const SPACE_URL_RE = new RegExp(`${APP_BASE}/spaces/`);

/** Matches a URL sitting on some change request — for `toHaveURL`. */
export const CHANGE_REQUEST_URL_RE = new RegExp(`${APP_BASE}/change-requests/`);
