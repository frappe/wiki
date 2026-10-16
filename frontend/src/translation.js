export default function translationPlugin(app) {
	app.config.globalProperties.__ = translate;
	window.__ = translate;
}

// The Vite dev server serves index.html without the boot, so fetch the catalog before mount.
export async function ensureTranslations() {
	if (window.translated_messages) return;
	try {
		const response = await fetch(
			'/api/method/wiki.www.wiki_app.get_translated_messages',
		);
		window.translated_messages = (await response.json()).message || {};
	} catch {
		window.translated_messages = {};
	}
}

function format(message, replace) {
	return message.replace(/{(\d+)}/g, (match, number) =>
		typeof replace[number] !== 'undefined' ? replace[number] : match,
	);
}

function translate(message, replace, context = null) {
	const translatedMessages = window.translated_messages || {};
	let translatedMessage = '';

	if (context) {
		const key = `${message}:${context}`;
		if (translatedMessages[key]) {
			translatedMessage = translatedMessages[key];
		}
	}

	if (!translatedMessage) {
		translatedMessage = translatedMessages[message] || message;
	}

	const hasPlaceholders = /{\d+}/.test(message);
	if (!hasPlaceholders) {
		return translatedMessage;
	}

	return format(translatedMessage, replace);
}
