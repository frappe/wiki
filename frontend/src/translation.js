import { createResource } from 'frappe-ui';
import { shallowRef } from 'vue';

const messages = shallowRef(window.translatedMessages || {});

export default function translationPlugin(app) {
	app.config.globalProperties.__ = translate;
	window.__ = translate;
	if (!window.translatedMessages) fetchTranslations();
}

function format(message, replace) {
	return message.replace(/{(\d+)}/g, (match, number) =>
		typeof replace[number] !== 'undefined' ? replace[number] : match,
	);
}

function translate(message, replace, context = null) {
	const translatedMessages = messages.value;
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

function fetchTranslations() {
	createResource({
		url: 'wiki.api.get_translations',
		auto: true,
		transform: (data) => {
			window.translatedMessages = data;
			messages.value = data;
		},
	});
}
