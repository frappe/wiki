import { Fragment, Slice } from '@tiptap/pm/model';

const DATA_IMAGE = /^data:image\//i;

export function isDataImageSrc(src) {
	return typeof src === 'string' && DATA_IMAGE.test(src);
}

function newUploadId() {
	return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function tagImageAttrs(attrs, uploads) {
	const uploadId = newUploadId();
	uploads.push({ uploadId, src: attrs.src });
	return { ...attrs, uploadId, loading: true, error: null };
}

function tagFragment(fragment, uploads) {
	const children = [];
	for (const node of fragment.content) {
		if (node.type.name === 'image' && isDataImageSrc(node.attrs.src)) {
			children.push(node.type.create(tagImageAttrs(node.attrs, uploads)));
		} else {
			children.push(node.copy(tagFragment(node.content, uploads)));
		}
	}
	return Fragment.fromArray(children);
}

/**
 * Mark every pasted base64 image as an in-flight upload. The `loading` flag
 * keeps the base64 out of the serialized markdown until the upload swaps in
 * a file URL; a multi-megabyte data URI in the content makes every later
 * parse slow.
 */
export function tagDataImagesInSlice(slice) {
	const uploads = [];
	const content = tagFragment(slice.content, uploads);
	if (!uploads.length) return { slice, uploads };
	return {
		slice: new Slice(content, slice.openStart, slice.openEnd),
		uploads,
	};
}

/** Same as tagDataImagesInSlice, for TipTap JSON content. */
export function tagDataImagesInJSON(json) {
	const uploads = [];
	const walk = (node) => {
		if (!node || typeof node !== 'object') return node;
		if (node.type === 'image' && isDataImageSrc(node.attrs?.src)) {
			return { ...node, attrs: tagImageAttrs(node.attrs, uploads) };
		}
		if (!Array.isArray(node.content)) return node;
		return { ...node, content: node.content.map(walk) };
	};
	return { json: walk(json), uploads };
}

// Images pasted together upload in parallel; a shared name let one upload
// replace the other on the server.
export async function dataUrlToFile(dataUrl) {
	const blob = await (await fetch(dataUrl)).blob();
	const extension = blob.type.split('/')[1]?.split('+')[0] || 'png';
	const suffix = Math.random().toString(36).slice(2, 10);
	return new File([blob], `pasted-image-${suffix}.${extension}`, {
		type: blob.type,
	});
}
