import { onBeforeUnmount, onMounted, ref, toRaw } from 'vue';

// Reactive mirror of `editor.isEditable` for node views. Reading
// `props.editor.isEditable` during render throws in tiptap v3 while the view
// is still mounting — the editor's view is exposed through a proxy that
// rejects any property access (Vue's reactive ref-unwrap probe included) —
// so track editability via editor events on the raw instance instead.
// Mirrors frappe-ui's internal useNodeViewEditable, which isn't exported.
export function useNodeViewEditable(editorLike) {
	const editor = toRaw(editorLike);
	const isEditable = ref(safeIsEditable(editor));

	const sync = () => {
		isEditable.value = safeIsEditable(editor);
	};

	onMounted(() => {
		// Re-read on mount in case editability changed between setup and mount.
		sync();
		editor.on('update', sync);
		editor.on('transaction', sync);
	});

	onBeforeUnmount(() => {
		editor.off('update', sync);
		editor.off('transaction', sync);
	});

	return isEditable;
}

function safeIsEditable(editor) {
	try {
		return editor.isEditable;
	} catch {
		// tiptap throws when the view is accessed before it exists.
		return false;
	}
}
