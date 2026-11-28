import { beforeEach, expect, test, vi } from 'vitest';
import { uploadErrorMessage } from './upload-error.js';

beforeEach(() => {
	vi.stubGlobal('__', (text, values = []) =>
		text.replace(/{(\d+)}/g, (_, index) => values[index]),
	);
});

function uploadError(message, options = {}) {
	return Object.assign(new Error(message), { kind: 'server', ...options });
}

test('shows the reason the server sent', () => {
	expect(
		uploadErrorMessage(uploadError('File type of EXE is not allowed')),
	).toBe('Upload failed: File type of EXE is not allowed');
});

test('removes HTML tags from the server reason', () => {
	expect(
		uploadErrorMessage(uploadError('File type of <b>EXE</b> is not allowed')),
	).toBe('Upload failed: File type of EXE is not allowed');
});

test('keeps a less-than sign that is not a tag', () => {
	expect(uploadErrorMessage(uploadError('Size must be < 5 MB'))).toBe(
		'Upload failed: Size must be < 5 MB',
	);
});

test('does not repeat itself when the server sent no reason', () => {
	expect(
		uploadErrorMessage(uploadError('Upload failed', { status: 500 })),
	).toBe('Upload failed: The file could not be saved. Try again.');
});

test('prefers the server reason on a 413', () => {
	expect(
		uploadErrorMessage(uploadError('File exceeds 10 MB', { status: 413 })),
	).toBe('Upload failed: File exceeds 10 MB');
});

test('says the file is too large on a 413 without a reason', () => {
	expect(
		uploadErrorMessage(uploadError('Upload failed', { status: 413 })),
	).toBe('Upload failed: This file is too large to upload.');
});

test.each([
	['a network error', { kind: 'network' }],
	['status 0', { kind: 'server', status: 0 }],
])('asks to check the connection on %s', (_, options) => {
	expect(uploadErrorMessage(uploadError('Upload failed', options))).toBe(
		'Upload failed: Check your connection and try again.',
	);
});

test('hides technical text from errors that are not upload errors', () => {
	expect(uploadErrorMessage(new TypeError('Failed to fetch'))).toBe(
		'Upload failed: The file could not be saved. Try again.',
	);
});
