// ─── Lingo-Mail Background Service Worker ───
// Routes messages between content script and Lingo.dev API + Gemini API
// API endpoints derived from @lingo.dev/_sdk source code

const LINGO_API_BASE = "https://engine.lingo.dev";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = "gemini-2.5-flash";

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
            ["lingoApiKey", "geminiApiKey", "targetLanguage", "autoTranslate"],
            (result) => {
                resolve({
                    apiKey: result.lingoApiKey || "",
                    geminiApiKey: result.geminiApiKey || "",
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

// ── Gemini API Helpers ──

/**
 * Call Gemini API to summarize email text.
 * Endpoint: POST /v1beta/models/gemini-2.5-flash:generateContent?key={apiKey}
 */
async function summarizeText(text, apiKey) {
    const prompt = `You are an email summarizer. Summarize the following email concisely in 2-3 bullet points. Focus on the key information, action items, and important details. Use plain text, no markdown formatting. Keep each bullet point on its own line starting with "•".

Email:
${text}`;

    const response = await fetch(
        `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }],
                    },
                ],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 1024,
                },
            }),
        }
    );

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
    }

    const jsonResponse = await response.json();
    const candidate = jsonResponse.candidates?.[0];
    if (!candidate || !candidate.content?.parts) {
        throw new Error("No summary generated by Gemini");
    }

    // gemini-2.5-flash is a thinking model — extract the last non-thought part
    const parts = candidate.content.parts;
    let summaryText = "";
    for (let i = parts.length - 1; i >= 0; i--) {
        if (!parts[i].thought && parts[i].text) {
            summaryText = parts[i].text;
            break;
        }
    }

    if (!summaryText) {
        throw new Error("No summary text found in Gemini response");
    }
    return summaryText;
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

    if (request.action === "summarize") {
        handleSummarize(request).then(sendResponse).catch((err) => {
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

async function handleSummarize(request) {
    const settings = await getSettings();
    if (!settings.geminiApiKey) {
        throw new Error("No Gemini API key configured. Please set your Gemini API key in the extension settings.");
    }
    const result = await summarizeText(request.text, settings.geminiApiKey);
    return { summary: result };
}
