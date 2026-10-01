import { Markdown } from '@tiptap/markdown';
import { Marked } from 'marked-tiptap';

export const WIKI_MARKED_OPTIONS = { breaks: true };

/**
 * The Markdown extension with a `marked` instance of its own.
 *
 * Without one, @tiptap/markdown registers every custom tokenizer on the global
 * `marked` singleton, once per editor. Each page opened in the SPA mounts a
 * new editor, so the tokenizers piled up and every parse slowed down for the
 * rest of the session.
 */
export function wikiMarkdown() {
	return Markdown.configure({
		marked: new Marked(),
		markedOptions: WIKI_MARKED_OPTIONS,
	});
}
