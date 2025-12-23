export { translate as __ };
if (!globalThis.translatedMessages) fetchTranslations();
globalThis.__ = translate;

function format(message, replace) {
  return message.replace(/{(\d+)}/g, (match, number) =>
    replace[number] === undefined ? match : replace[number],
  );
}

function translate(message, replace, context = null) {
  const translatedMessages = globalThis.translatedMessages || {};
  let translatedMessage = "";

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
  fetch("/api/method/wiki.api.get_translations")
    .then((response) => response.json())
    .then((data) => {
      globalThis.translatedMessages = data.message;
    });
}
