// Renders an OG card for wiki/api/og_satori.py: element tree to SVG with satori,
// SVG to PNG with resvg. The payload arrives on stdin because the tree carries
// data: URIs far past argv limits. The PNG goes to stdout, any error to stderr.
import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}

async function main() {
	const payload = JSON.parse(await readStdin());
	const fonts = payload.fonts.map((font) => ({
		name: font.name,
		data: readFileSync(font.path),
		weight: font.weight,
		style: 'normal',
	}));

	const svg = await satori(payload.tree, {
		width: payload.width,
		height: payload.height,
		fonts,
	});
	const png = new Resvg(svg, { fitTo: { mode: 'width', value: payload.width } })
		.render()
		.asPng();
	process.stdout.write(png);
}

main().catch((error) => {
	process.stderr.write(String(error?.stack || error));
	process.exit(1);
});
