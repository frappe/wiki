import { NodeSelection, TextSelection } from '@tiptap/pm/state';

// A block inserted with no text after it stays selected, so the next key
// replaces it. Move the cursor into the paragraph after it, adding one if needed.
export function insertBlock(chain, content) {
	return chain
		.insertContent(content)
		.command(({ tr, dispatch }) => {
			if (!dispatch || !(tr.selection instanceof NodeSelection)) return true;
			const after = tr.selection.to;
			if (!tr.doc.resolve(after).nodeAfter?.isTextblock) {
				tr.insert(after, tr.doc.type.schema.nodes.paragraph.create());
			}
			tr.setSelection(TextSelection.create(tr.doc, after + 1));
			return true;
		})
		.run();
}
