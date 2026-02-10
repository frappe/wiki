/**
 * TipTap Slash Commands Extension
 *
 * Provides "/" command menu for inserting elements.
 * Limited to Markdown-supported features.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Suggestion from '@tiptap/suggestion';

/**
 * Available slash commands - limited to Markdown-supported features
 */
export const SLASH_COMMANDS = [
	{
		title: 'Heading 1',
		description: 'Large section heading',
		icon: 'heading-1',
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run();
		},
	},
	{
		title: 'Heading 2',
		description: 'Medium section heading',
		icon: 'heading-2',
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run();
		},
	},
	{
		title: 'Heading 3',
		description: 'Small section heading',
		icon: 'heading-3',
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run();
		},
	},
	{
		title: 'Bullet List',
		description: 'Create a bullet list',
		icon: 'list',
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).toggleBulletList().run();
		},
	},
	{
		title: 'Numbered List',
		description: 'Create a numbered list',
		icon: 'list-ordered',
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).toggleOrderedList().run();
		},
	},
	{
		title: 'Task List',
		description: 'Create a task list with checkboxes',
		icon: 'list-checks',
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).toggleTaskList().run();
		},
	},
	{
		title: 'Code Block',
		description: 'Add a code block with syntax highlighting',
		icon: 'code',
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
		},
	},
	{
		title: 'Blockquote',
		description: 'Add a blockquote',
		icon: 'quote',
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).toggleBlockquote().run();
		},
	},
	{
		title: 'Horizontal Rule',
		description: 'Add a horizontal divider',
		icon: 'minus',
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).setHorizontalRule().run();
		},
	},
	{
		title: 'Table',
		description: 'Insert a table',
		icon: 'table',
		command: ({ editor, range }) => {
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
				.run();
		},
	},
	{
		title: 'Image',
		description: 'Upload an image',
		icon: 'image',
		command: ({ editor, range }) => {
			// Delete the slash command text first
			editor.chain().focus().deleteRange(range).run();
			// Dispatch a custom event that WikiEditor will listen for
			const event = new CustomEvent('wiki-editor-upload-image', {
				bubbles: true,
				detail: { editor },
			});
			document.dispatchEvent(event);
		},
	},
	{
		title: 'Video',
		description: 'Upload a video',
		icon: 'video',
		command: ({ editor, range }) => {
			editor.chain().focus().deleteRange(range).selectAndUploadVideo().run();
		},
	},
	{
		title: 'Note Callout',
		description: 'Add a note callout block',
		icon: 'info',
		command: ({ editor, range }) => {
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.insertContent({
					type: 'calloutBlock',
					attrs: { type: 'note', title: '', content: '' },
				})
				.run();
		},
	},
	{
		title: 'Tip Callout',
		description: 'Add a tip callout block',
		icon: 'lightbulb',
		command: ({ editor, range }) => {
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.insertContent({
					type: 'calloutBlock',
					attrs: { type: 'tip', title: '', content: '' },
				})
				.run();
		},
	},
	{
		title: 'Warning Callout',
		description: 'Add a warning callout block',
		icon: 'alert-triangle',
		command: ({ editor, range }) => {
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.insertContent({
					type: 'calloutBlock',
					attrs: {
						type: 'caution',
						title: '',
						content: '',
					},
				})
				.run();
		},
	},
	{
		title: 'Danger Callout',
		description: 'Add a danger callout block',
		icon: 'alert-octagon',
		command: ({ editor, range }) => {
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.insertContent({
					type: 'calloutBlock',
					attrs: {
						type: 'danger',
						title: '',
						content: '',
					},
				})
				.run();
		},
	},
];

/**
 * Filter commands by search query
 */
export function filterCommands(query) {
	if (!query) return SLASH_COMMANDS;

	const lowerQuery = query.toLowerCase();
	return SLASH_COMMANDS.filter(
		(cmd) =>
			cmd.title.toLowerCase().includes(lowerQuery) ||
			cmd.description.toLowerCase().includes(lowerQuery),
	);
}

/**
 * Slash Commands Extension
 */
export const SlashCommands = Extension.create({
	name: 'slashCommands',

	addOptions() {
		return {
			suggestion: {
				char: '/',
				startOfLine: false,
				command: ({ editor, range, props }) => {
					props.command({ editor, range });
				},
			},
		};
	},

	addProseMirrorPlugins() {
		return [
			Suggestion({
				editor: this.editor,
				...this.options.suggestion,
			}),
		];
	},
});

export default SlashCommands;
