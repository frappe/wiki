import { frappeRequest } from 'frappe-ui';

const TRANSLATION_LOAD_TIMEOUT = 10_000;

export async function loadTranslations() {
	if (window.translatedMessages) return;

	const controller = new AbortController();
	const timeoutId = window.setTimeout(
		() => controller.abort(),
		TRANSLATION_LOAD_TIMEOUT,
	);

	try {
		window.translatedMessages =
			(await frappeRequest({
				url: 'wiki.api.get_translations',
				signal: controller.signal,
			})) || {};
	} catch (error) {
		console.warn('Unable to load translations; using source messages.', error);
		window.translatedMessages = {};
	} finally {
		window.clearTimeout(timeoutId);
	}
}

export default function translationPlugin(app) {
	app.config.globalProperties.__ = translate;
	window.__ = translate;
}

function format(message, replace) {
	return message.replace(/{(\d+)}/g, (match, number) =>
		typeof replace[number] !== 'undefined' ? replace[number] : match,
	);
}

function translate(message, replace, context = null) {
	const translatedMessages = window.translatedMessages || {};
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
