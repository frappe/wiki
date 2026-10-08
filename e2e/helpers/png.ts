import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

function crc32(buf: Buffer): number {
	let c = ~0;
	for (let i = 0; i < buf.length; i++) {
		c ^= buf[i];
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([len, body, crc]);
}

/**
 * Build a valid RGB PNG entirely in Node, with a unique `tEXt` chunk so the
 * bytes (and thus Frappe's content hash) differ on every call — even across
 * separate test-process runs. Without this, identical bytes would trigger
 * Frappe's content-hash file deduplication and make one upload reuse another's
 * (possibly already-converted) file. Pillow ignores the tEXt chunk on decode,
 * so the server-side WebP conversion still works.
 */
export function makeUniquePng(
	size = 8,
	color: [number, number, number] = [40, 120, 220],
): Buffer {
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // color type: RGB
	const pixel = Buffer.from(color);
	const row = Buffer.concat([Buffer.from([0]), ...Array(size).fill(pixel)]);
	const raw = Buffer.concat(Array(size).fill(row));
	// tEXt chunk: keyword \0 text — carries a unique nonce.
	const nonce = Buffer.from(`Comment\0${randomUUID()}`, 'latin1');
	return Buffer.concat([
		sig,
		pngChunk('IHDR', ihdr),
		pngChunk('tEXt', nonce),
		pngChunk('IDAT', deflateSync(raw)),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
}
