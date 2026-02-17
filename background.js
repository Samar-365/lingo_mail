// ─── Lingo-Mail Background Service Worker ───
// Routes messages between content script and Lingo.dev API
// API endpoints derived from @lingo.dev/_sdk source code

const LINGO_API_BASE = "https://engine.lingo.dev";

// ── Lingo.dev API Helpers ──

async function getApiKey() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["lingoApiKey"], (result) => {
            resolve(result.lingoApiKey || "");
        });
    });
}

async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(
            ["lingoApiKey", "targetLanguage", "autoTranslate"],
            (result) => {
                resolve({
                    apiKey: result.lingoApiKey || "",
                    targetLanguage: result.targetLanguage || "en",
                    autoTranslate: result.autoTranslate !== false,
                });
            }
        );
    });
}

/**
 * Call Lingo.dev Engine API for text translation.
 * Endpoint: POST /i18n
 * Body: { locale: { source, target }, data: { text: "..." } }
 * Response: { data: { text: "..." } }
 */
async function translateText(text, sourceLocale, targetLocale, apiKey) {
    const response = await fetch(`${LINGO_API_BASE}/i18n`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            params: { workflowId: crypto.randomUUID(), fast: false },
            locale: {
                source: sourceLocale || null,
                target: targetLocale,
            },
            data: {
                text: text,
            },
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Lingo.dev API error (${response.status}): ${errorBody}`);
    }

    const jsonResponse = await response.json();
    if (!jsonResponse.data && jsonResponse.error) {
        throw new Error(jsonResponse.error);
    }
    return jsonResponse.data?.text || "";
}

/**
 * Call Lingo.dev Engine API for HTML translation.
 * Since the API doesn't have a direct HTML endpoint, we translate the
 * text content and return it. For simple emails this works well.
 * We send the HTML as a text chunk for translation.
 */
async function translateHtml(html, sourceLocale, targetLocale, apiKey) {
    // Extract text from HTML for translation, then return translated text
    // The API works with key-value pairs, so we send html as a value
    const response = await fetch(`${LINGO_API_BASE}/i18n`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            params: { workflowId: crypto.randomUUID(), fast: false },
            locale: {
                source: sourceLocale || null,
                target: targetLocale,
            },
            data: {
                content: html,
            },
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Lingo.dev API error (${response.status}): ${errorBody}`);
    }

    const jsonResponse = await response.json();
    if (!jsonResponse.data && jsonResponse.error) {
        throw new Error(jsonResponse.error);
    }
    return jsonResponse.data?.content || "";
}

/**
 * Call Lingo.dev Engine API for language detection.
 * Endpoint: POST /recognize
 * Body: { text }
 * Response: { locale: "en" }
 */
async function detectLanguage(text, apiKey) {
    const response = await fetch(`${LINGO_API_BASE}/recognize`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ text }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Lingo.dev API error (${response.status}): ${errorBody}`);
    }

    const jsonResponse = await response.json();
    return jsonResponse.locale || "unknown";
}

// ── Message Listener ──

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate") {
        handleTranslate(request).then(sendResponse).catch((err) => {
            sendResponse({ error: err.message });
        });
        return true; // async response
    }

    if (request.action === "translateHtml") {
        handleTranslateHtml(request).then(sendResponse).catch((err) => {
            sendResponse({ error: err.message });
        });
        return true;
    }

    if (request.action === "detectLanguage") {
        handleDetectLanguage(request).then(sendResponse).catch((err) => {
            sendResponse({ error: err.message });
        });
        return true;
    }

    if (request.action === "getSettings") {
        getSettings().then(sendResponse);
        return true;
    }
});

async function handleTranslate(request) {
    const settings = await getSettings();
    if (!settings.apiKey) {
        throw new Error("No API key configured. Please set your Lingo.dev API key in the extension settings.");
    }
    const targetLocale = request.targetLocale || settings.targetLanguage;
    const result = await translateText(
        request.text,
        request.sourceLocale || null,
        targetLocale,
        settings.apiKey
    );
    return { translatedText: result, targetLocale };
}

async function handleTranslateHtml(request) {
    const settings = await getSettings();
    if (!settings.apiKey) {
        throw new Error("No API key configured. Please set your Lingo.dev API key in the extension settings.");
    }
    const targetLocale = request.targetLocale || settings.targetLanguage;
    const result = await translateHtml(
        request.html,
        request.sourceLocale || null,
        targetLocale,
        settings.apiKey
    );
    return { translatedHtml: result, targetLocale };
}

async function handleDetectLanguage(request) {
    const settings = await getSettings();
    if (!settings.apiKey) {
        throw new Error("No API key configured. Please set your Lingo.dev API key in the extension settings.");
    }
    const result = await detectLanguage(request.text, settings.apiKey);
    return { detectedLocale: result };
}
