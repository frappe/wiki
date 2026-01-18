import { Mark, getMarkRange, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Custom Link extension with inline editor support
 * Adds Cmd+K keyboard shortcut to open link editor
 */
export const WikiLink = Mark.create({
	name: 'link',

	priority: 1000,

	keepOnSplit: false,

	inclusive() {
		return this.options.autolink;
	},

	// TipTap v3 Markdown extension support
	// Register as handler for 'link' tokens from marked.js
	markdownTokenName: 'link',

	// Parse markdown link tokens into link marks
	// Token format: { type: 'link', href: '...', title: '...', tokens: [...] }
	parseMarkdown(token, helpers) {
		// Parse the link's child tokens (the link text)
		const content = helpers.parseInline(token.tokens || []);
		// Return a mark result that wraps content with the link mark
		return helpers.applyMark('link', content, {
			href: token.href || null,
		});
	},

	// Renders link marks to markdown format: [text](url)
	// Guards against empty href to avoid outputting invalid markdown like [text]()
	renderMarkdown(node, helpers) {
		const href = node.attrs?.href || '';
		const content = helpers.renderChildren();
		// If no href, just return the content without link formatting
		if (!href) {
			return content;
		}
		return `[${content}](${href})`;
	},

	addOptions() {
		return {
			openOnClick: false,
			autolink: true,
			linkOnPaste: true,
			HTMLAttributes: {
				target: '_blank',
				rel: 'noopener noreferrer',
			},
			// Callback function to show link popup
			onOpenLinkEditor: null,
		};
	},

	addAttributes() {
		return {
			href: {
				default: null,
			},
			target: {
				default: this.options.HTMLAttributes.target,
			},
			rel: {
				default: this.options.HTMLAttributes.rel,
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: 'a[href]:not([href *= "javascript:" i])',
			},
		];
	},

	renderHTML({ HTMLAttributes }) {
		return [
			'a',
			mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
			0,
		];
	},

	addCommands() {
		return {
			setLink:
				(attributes) =>
				({ chain }) => {
					return chain()
						.setMark(this.name, attributes)
						.setMeta('preventAutolink', true)
						.run();
				},

			toggleLink:
				(attributes) =>
				({ chain }) => {
					return chain()
						.toggleMark(this.name, attributes, { extendEmptyMarkRange: true })
						.setMeta('preventAutolink', true)
						.run();
				},

			unsetLink:
				() =>
				({ chain }) => {
					return chain()
						.unsetMark(this.name, { extendEmptyMarkRange: true })
						.setMeta('preventAutolink', true)
						.run();
				},

			openLinkEditor:
				() =>
				({ editor, state }) => {
					const { from, to, empty } = state.selection;
					const linkMark = editor.isActive('link');

					// If no text is selected and not in a link, do nothing
					if (empty && !linkMark) {
						return false;
					}

					// Get the link mark range if cursor is within a link
					let linkRange = null;
					let currentHref = '';

					if (linkMark) {
						const $pos = state.doc.resolve(from);
						const markType = state.schema.marks.link;
						const range = getMarkRange($pos, markType);

						if (range) {
							linkRange = range;
							// Get the current href
							const marks = $pos.marks();
							const linkMarkInstance = marks.find(
								(m) => m.type.name === 'link',
							);
							if (linkMarkInstance) {
								currentHref = linkMarkInstance.attrs.href || '';
							}
						}
					}

					// Select the link text if we found a range
					if (linkRange) {
						editor.chain().setTextSelection(linkRange).run();
					}

					// Call the callback to show the popup
					if (this.options.onOpenLinkEditor) {
						// Use requestAnimationFrame to ensure selection is complete
						requestAnimationFrame(() => {
							const selection = window.getSelection();
							if (selection && selection.rangeCount > 0) {
								const range = selection.getRangeAt(0);
								const rect = range.getBoundingClientRect();

								this.options.onOpenLinkEditor({
									editor,
									href: currentHref,
									isNew: !linkMark,
									rect,
									from: linkRange?.from ?? from,
									to: linkRange?.to ?? to,
								});
							}
						});
					}

					return true;
				},
		};
	},

	addKeyboardShortcuts() {
		return {
			'Mod-k': () => this.editor.commands.openLinkEditor(),
		};
	},

	addProseMirrorPlugins() {
		const plugins = [];

		// Click handler plugin
		plugins.push(
			new Plugin({
				key: new PluginKey('wikiLinkClick'),
				props: {
					handleClick: (view, pos, event) => {
						// Cmd/Ctrl + Click opens link in new tab
						if (event.metaKey || event.ctrlKey) {
							const { state } = view;
							const $pos = state.doc.resolve(pos);
							const marks = $pos.marks();
							const linkMark = marks.find((m) => m.type.name === 'link');

							if (linkMark?.attrs.href) {
								window.open(linkMark.attrs.href, '_blank');
								return true;
							}
						}

						return false;
					},
				},
			}),
		);

		// Autolink on paste plugin
		if (this.options.linkOnPaste) {
			plugins.push(
				new Plugin({
					key: new PluginKey('wikiLinkPaste'),
					props: {
						handlePaste: (view, event) => {
							const { state } = view;
							const { selection } = state;
							const { empty } = selection;

							// Only autolink if there's selected text
							if (empty) {
								return false;
							}

							const text = event.clipboardData?.getData('text/plain');
							if (!text) {
								return false;
							}

							// Check if pasted text is a URL
							const urlPattern = /^https?:\/\/[^\s]+$/;
							if (!urlPattern.test(text.trim())) {
								return false;
							}

							// Apply link to selected text
							this.editor.chain().setLink({ href: text.trim() }).run();

							return true;
						},
					},
				}),
			);
		}

		return plugins;
	},
});

export default WikiLink;
