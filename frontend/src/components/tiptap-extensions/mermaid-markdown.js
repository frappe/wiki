const MERMAID_FENCE_RE =
	/^(```|~~~)mermaid[^\n]*\n([\s\S]*?)\n\1[ \t]*(?:\n|$)/;

export function parseMermaidFence(source) {
	const match = MERMAID_FENCE_RE.exec(source);
	if (!match) return null;

	return {
		raw: match[0],
		code: match[2].replace(/\s+$/, ''),
	};
}

export function renderMermaidFence(code) {
	return `\`\`\`mermaid\n${String(code || '').replace(/\s+$/, '')}\n\`\`\`\n\n`;
}
