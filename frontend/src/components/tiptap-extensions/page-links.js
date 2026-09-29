/**
 * Obsidian-style internal links: typing "[[" opens a picker of the space's
 * pages, and picking one inserts `[Title](wiki:<doc_key>)`. The reader resolves
 * `wiki:` links to the page's current route, so they survive moves and route
 * edits (see resolve_wiki_links in wiki_document.py).
 */

import { Extension, InputRule, getMarkRange } from '@tiptap/core';
import { PluginKey, TextSelection } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';

export const WIKI_LINK_PREFIX = 'wiki:';

export function docKeyFromHref(href) {
	return href?.startsWith(WIKI_LINK_PREFIX)
		? href.slice(WIKI_LINK_PREFIX.length)
		: null;
}

/**
 * Linkable pages in tree order, each with the trail of folders above it so
 * same-titled pages in different folders can be told apart.
 */
export function linkablePages(nodes, trail = []) {
	const pages = [];
	for (const node of nodes || []) {
		if (node.is_deleted || node.is_external_link) continue;
		if (node.is_group) {
			pages.push(...linkablePages(node.children, [...trail, node.title]));
		} else if (node.doc_key) {
			pages.push({
				key: node.doc_key,
				title: node.title,
				trail,
				isPublished: node.is_published !== false,
			});
		}
	}
	return pages;
}

const PAGE_LIMIT = 8;

// Lower is better; null means no match at all.
function rank(title, query) {
	const lowerTitle = title.toLowerCase();
	if (!query) return 0;
	if (lowerTitle.startsWith(query)) return 1;
	if (lowerTitle.split(/\s+/).some((word) => word.startsWith(query))) return 2;
	if (lowerTitle.includes(query)) return 3;
	let matched = 0;
	for (const char of lowerTitle) if (char === query[matched]) matched++;
	return matched === query.length ? 4 : null;
}

/**
 * The best pages for a query. Scattered-letter matches are a fallback for
 * typos, not padding: once any title contains the query, they only add noise.
 */
export function rankPages(pages, query) {
	const lowerQuery = query.trim().toLowerCase();
	const ranked = pages
		.map((page) => ({ page, rank: rank(page.title || '', lowerQuery) }))
		.filter((each) => each.rank !== null);
	const direct = ranked.filter((each) => each.rank < 4);
	return (direct.length ? direct : ranked)
		.sort((a, b) => a.rank - b.rank || a.page.title.localeCompare(b.page.title))
		.slice(0, PAGE_LIMIT)
		.map((each) => each.page);
}

/**
 * The picker's rows: the best pages for the query, then an offer to create a
 * page by that name. Offering to create is only honest when no page already
 * carries the name, the open page included.
 */
export function pickerItems(pages, query, openPageKey) {
	const title = query.trim();
	const taken = pages.some(
		(page) => page.title?.toLowerCase() === title.toLowerCase(),
	);
	return [
		...rankPages(
			pages.filter((page) => page.key !== openPageKey),
			query,
		),
		...(title && !taken ? [{ create: true, key: 'create', title }] : []),
	];
}

export function findPageByTitle(pages, title) {
	const lowerTitle = title.toLowerCase();
	return pages.find((page) => page.title?.toLowerCase() === lowerTitle) || null;
}

/**
 * Backspace inside or at the end of a page link turns the whole link back into
 * `[[Title`, which reopens the picker so the author can point it at another
 * page. Inside counts too: Chrome's ArrowLeft steps over a link's end, so the
 * caret rarely lands exactly on it.
 */
export function reopenPageLink(editor) {
	const { state, view } = editor;
	// Read the caret from the DOM: Chrome reports arrow-key moves through an
	// async selectionchange, so a quick Backspace can find state.selection stale.
	const domSelection = view.root.getSelection();
	if (!domSelection?.isCollapsed || !domSelection.focusNode) return false;
	const $from = state.doc.resolve(
		view.posAtDOM(domSelection.focusNode, domSelection.focusOffset),
	);

	const linkType = state.schema.marks.link;
	const link = $from.nodeBefore?.marks.find((mark) => mark.type === linkType);
	if (!docKeyFromHref(link?.attrs.href)) return false;

	const range = getMarkRange(
		state.doc.resolve($from.pos - 1),
		linkType,
		link.attrs,
	);
	if (!range) return false;

	const text = `[[${state.doc.textBetween(range.from, range.to)}`;
	return editor.commands.command(({ tr }) => {
		tr.replaceWith(range.from, range.to, state.schema.text(text));
		tr.setSelection(TextSelection.create(tr.doc, range.from + text.length));
		tr.removeStoredMark(linkType);
		return true;
	});
}

/**
 * Replace `range` with the page's title, linked when the page has a key. The
 * caret must end up past a space: typing on from the end of a link would
 * extend it. A space already after the range (a retargeted link had one) is
 * reused rather than doubled.
 */
function insertPageLink(chain, doc, range, page) {
	const nextChar = doc.textBetween(
		range.to,
		Math.min(range.to + 1, doc.content.size),
	);
	const hasSpaceAfter = /^\s/.test(nextChar);
	const marks = page.key
		? [{ type: 'link', attrs: { href: `${WIKI_LINK_PREFIX}${page.key}` } }]
		: [];
	return chain
		.deleteRange(range)
		.insertContent([
			{ type: 'text', text: page.title, marks },
			...(hasSpaceAfter ? [] : [{ type: 'text', text: ' ' }]),
		])
		.command(({ tr }) => {
			if (hasSpaceAfter) {
				tr.setSelection(TextSelection.create(tr.doc, tr.selection.from + 1));
			}
			return true;
		})
		.run();
}

/**
 * Create a draft page and link its title. The title goes in at once; the link
 * waits for the page's real doc_key, because a `tmp_*` key saved into content
 * would point nowhere once the create lands. The title's range follows every
 * edit made meanwhile; if the title itself was edited, the page still exists
 * and only the link is skipped.
 */
async function createAndLink(editor, range, title, createPage) {
	insertPageLink(editor.chain().focus(), editor.state.doc, range, { title });
	let from = range.from;
	let to = from + title.length;
	// Text typed right at either edge lands outside the title.
	const follow = ({ transaction }) => {
		from = transaction.mapping.map(from, 1);
		to = transaction.mapping.map(to, -1);
	};
	editor.on('transaction', follow);

	let key;
	try {
		key = await createPage(title);
	} finally {
		editor.off('transaction', follow);
	}
	if (!key || editor.isDestroyed) return;
	const { doc, schema } = editor.state;
	if (doc.textBetween(from, to) !== title) return;
	editor.commands.command(({ tr }) => {
		tr.addMark(
			from,
			to,
			schema.marks.link.create({ href: `${WIKI_LINK_PREFIX}${key}` }),
		);
		return true;
	});
}

export const PageLinks = Extension.create({
	name: 'pageLinks',

	addOptions() {
		return {
			suggestion: {
				char: '[[',
				allowSpaces: true,
				pluginKey: new PluginKey('pageLinks'),
			},
			// The page whose title is exactly `title`, for a typed `[[Title]]`.
			findPage: () => null,
			// Creates a draft page and resolves to its doc_key.
			createPage: null,
		};
	},

	addKeyboardShortcuts() {
		return {
			Backspace: () => reopenPageLink(this.editor),
		};
	},

	// Typing the closing brackets by hand links an exact title without the
	// picker.
	addInputRules() {
		return [
			new InputRule({
				find: /\[\[([^[\]\n]{1,60})\]\]$/,
				handler: ({ state, range, match, chain }) => {
					const page = this.options.findPage(match[1].trim());
					if (!page) return null;
					insertPageLink(chain(), state.doc, range, page);
				},
			}),
		];
	},

	addProseMirrorPlugins() {
		return [
			Suggestion({
				editor: this.editor,
				...this.options.suggestion,
				command: ({ editor, range, props }) => {
					if (props.create) {
						createAndLink(editor, range, props.title, this.options.createPage);
						return;
					}
					insertPageLink(
						editor.chain().focus(),
						editor.state.doc,
						range,
						props,
					);
				},
			}),
		];
	},
});
