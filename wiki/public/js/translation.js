export { translate as __ };

globalThis.translatedMessages = globalThis.translatedMessages || null;

let translationsPromise = null;

globalThis.__ = translate;

ensureTranslationsLoaded();

function ensureTranslationsLoaded() {
  if (!translationsPromise) {
    translationsPromise = fetchTranslations();
  }
  return translationsPromise;
}

function translate(message, replace = [], context = null) {
  const messages = globalThis.translatedMessages;

  if (!messages) {
    return format(message, replace);
  }

  let translatedMessage = "";

  if (context) {
    const contextualKey = `${message}:${context}`;
    translatedMessage = messages[contextualKey] || "";
  }

  if (!translatedMessage) {
    translatedMessage = messages[message] || message;
  }

  return hasPlaceholders(translatedMessage)
    ? format(translatedMessage, replace)
    : translatedMessage;
}

function format(message, replace) {
  if (!replace?.length) return message;

  return message.replace(/{(\d+)}/g, (match, index) => replace[index] ?? match);
}

function hasPlaceholders(message) {
  return /{\d+}/.test(message);
}

async function fetchTranslations() {
  try {
    const response = await fetch("/api/method/wiki.api.get_translations");
    const data = await response.json();
    globalThis.translatedMessages = data.message || {};
  } catch (error) {
    console.error("Failed to load translations", error);
    globalThis.translatedMessages = {};
  }
}
