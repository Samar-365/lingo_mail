// ─── Lingo-Mail Content Script ───
// Interacts with Gmail DOM to detect emails, inject translations, and handle reply translation

(function () {
    "use strict";

    // ── State ──
    const translatedEmails = new Map();
    let observerActive = false;
    let settings = { targetLanguage: "en", autoTranslate: true };

    // ── Initialization ──
    async function init() {
        const response = await chrome.runtime.sendMessage({ action: "getSettings" });
        if (response) {
            settings = {
                targetLanguage: response.targetLanguage || "en",
                autoTranslate: response.autoTranslate !== false,
            };
        }
        observeGmail();
    }

    // ── Gmail DOM Observer ──
    function observeGmail() {
        if (observerActive) return;
        observerActive = true;

        const observer = new MutationObserver(debounce(() => {
            processEmailView();
            processComposeWindow();
        }, 500));

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        setTimeout(() => {
            processEmailView();
            processComposeWindow();
        }, 2000);
    }

    // ── Process Email View ──
    function processEmailView() {
        const emailBodies = document.querySelectorAll(
            'div.a3s.aiL, div[data-message-id] div.a3s'
        );

        emailBodies.forEach((emailBody) => {
            if (emailBody.dataset.lingoProcessed) return;

            const messageContainer = emailBody.closest('[data-message-id]') || emailBody.closest('.gs');
            const messageId = messageContainer?.getAttribute('data-message-id') ||
                'msg-' + hashCode(emailBody.textContent.substring(0, 100));

            emailBody.dataset.lingoProcessed = "true";
            emailBody.dataset.lingoMessageId = messageId;

            if (settings.autoTranslate) {
                translateEmailBody(emailBody, messageId);
            } else {
                injectTranslateButton(emailBody, messageId);
            }
        });
    }

    // ── Translate Email Body ──
    async function translateEmailBody(emailBody, messageId) {
        if (translatedEmails.has(messageId)) return;

        const originalHtml = emailBody.innerHTML;
        const originalText = emailBody.innerText.trim();

        if (!originalText || originalText.length < 5) return;

        const loadingBar = createLoadingBar();
        emailBody.parentElement.insertBefore(loadingBar, emailBody.nextSibling);

        try {
            const detectResult = await chrome.runtime.sendMessage({
                action: "detectLanguage",
                text: originalText.substring(0, 500),
            });

            const detectedLocale = detectResult?.detectedLocale || "unknown";

            if (detectedLocale === settings.targetLanguage) {
                loadingBar.remove();
                injectLanguageBadge(emailBody, detectedLocale, false);
                return;
            }

            const translateResult = await chrome.runtime.sendMessage({
                action: "translateHtml",
                html: originalHtml,
                sourceLocale: detectedLocale !== "unknown" ? detectedLocale : null,
                targetLocale: settings.targetLanguage,
            });

            if (translateResult?.error) {
                loadingBar.remove();
                showError(emailBody, translateResult.error);
                return;
            }

            translatedEmails.set(messageId, {
                originalHtml,
                translatedHtml: translateResult.translatedHtml,
                detectedLocale,
                targetLocale: translateResult.targetLocale,
                showingTranslation: true,
            });

            loadingBar.remove();
            injectTranslation(emailBody, messageId);

        } catch (err) {
            loadingBar.remove();
            showError(emailBody, err.message);
        }
    }

    // ── Inject Translation Block ──
    function injectTranslation(emailBody, messageId) {
        const data = translatedEmails.get(messageId);
        if (!data) return;

        const existingBlock = emailBody.parentElement.querySelector('.lingo-translation-block');
        if (existingBlock) existingBlock.remove();

        const block = document.createElement("div");
        block.className = "lingo-translation-block";

        const header = document.createElement("div");
        header.className = "lingo-header";

        const langInfo = document.createElement("span");
        langInfo.className = "lingo-lang-info";
        langInfo.innerHTML = `
      <span class="lingo-icon">🌐</span>
      <span>Translated from <strong>${getLanguageName(data.detectedLocale)}</strong> to <strong>${getLanguageName(data.targetLocale)}</strong></span>
    `;

        const toggleBtn = document.createElement("button");
        toggleBtn.className = "lingo-toggle-btn";
        toggleBtn.textContent = "Show Original";
        toggleBtn.addEventListener("click", () => {
            toggleTranslation(emailBody, messageId, toggleBtn);
        });

        header.appendChild(langInfo);
        header.appendChild(toggleBtn);

        const translatedContent = document.createElement("div");
        translatedContent.className = "lingo-translated-content";
        translatedContent.innerHTML = data.translatedHtml;

        block.appendChild(header);
        block.appendChild(translatedContent);

        emailBody.style.display = "none";
        emailBody.parentElement.insertBefore(block, emailBody.nextSibling);
    }

    // ── Toggle Original / Translated ──
    function toggleTranslation(emailBody, messageId, toggleBtn) {
        const data = translatedEmails.get(messageId);
        if (!data) return;

        const block = emailBody.parentElement.querySelector('.lingo-translation-block');
        if (!block) return;

        if (data.showingTranslation) {
            emailBody.style.display = "";
            block.querySelector('.lingo-translated-content').style.display = "none";
            toggleBtn.textContent = "Show Translation";
            data.showingTranslation = false;
        } else {
            emailBody.style.display = "none";
            block.querySelector('.lingo-translated-content').style.display = "";
            toggleBtn.textContent = "Show Original";
            data.showingTranslation = true;
        }
    }

    // ── Manual Translate Button (when auto-translate is off) ──
    function injectTranslateButton(emailBody, messageId) {
        if (emailBody.parentElement.querySelector('.lingo-manual-btn')) return;

        const btn = document.createElement("button");
        btn.className = "lingo-manual-btn";
        btn.innerHTML = '🌐 Translate with Lingo-Mail';
        btn.addEventListener("click", () => {
            btn.remove();
            translateEmailBody(emailBody, messageId);
        });

        emailBody.parentElement.insertBefore(btn, emailBody);
    }

    // ── Process Compose Window (Reply Translation) ──
    function processComposeWindow() {
        const composeWindows = document.querySelectorAll(
            'div[role="dialog"] div[contenteditable="true"], ' +
            'div.Am.Al.editable, ' +
            'div[aria-label="Message Body"][contenteditable="true"], ' +
            'div.editable[contenteditable="true"]'
        );

        composeWindows.forEach((composeBody) => {
            if (composeBody.dataset.lingoComposeProcessed) return;
            composeBody.dataset.lingoComposeProcessed = "true";
            injectReplyTranslateButton(composeBody);
        });
    }

    // ── Inject Reply Translate Button ──
    function injectReplyTranslateButton(composeBody) {
        const composeContainer = composeBody.closest('div[role="dialog"]') ||
            composeBody.closest('.iN') ||
            composeBody.closest('.M9');
        if (!composeContainer) return;

        const sendBtnRow = composeContainer.querySelector('.btC') ||
            composeContainer.querySelector('div[data-tooltip="Send"]')?.parentElement?.parentElement;

        if (!sendBtnRow) {
            const btn = createReplyTranslateBtn(composeBody);
            composeBody.parentElement.insertBefore(btn, composeBody);
            return;
        }

        if (sendBtnRow.querySelector('.lingo-reply-btn')) return;

        const btn = createReplyTranslateBtn(composeBody);
        sendBtnRow.appendChild(btn);
    }

    function createReplyTranslateBtn(composeBody) {
        const wrapper = document.createElement("div");
        wrapper.className = "lingo-reply-wrapper";

        const btn = document.createElement("button");
        btn.className = "lingo-reply-btn";
        btn.innerHTML = '🌐 Translate Reply';

        const langSelect = document.createElement("select");
        langSelect.className = "lingo-reply-lang-select";
        LANGUAGES.forEach(([code, name]) => {
            const opt = document.createElement("option");
            opt.value = code;
            opt.textContent = name;
            langSelect.appendChild(opt);
        });

        btn.addEventListener("click", async () => {
            const text = composeBody.innerText.trim();
            if (!text) return;

            btn.disabled = true;
            btn.innerHTML = '⏳ Translating...';

            try {
                const result = await chrome.runtime.sendMessage({
                    action: "translate",
                    text: text,
                    sourceLocale: null,
                    targetLocale: langSelect.value,
                });

                if (result?.error) {
                    btn.innerHTML = '❌ Error';
                    setTimeout(() => { btn.innerHTML = '🌐 Translate Reply'; btn.disabled = false; }, 3000);
                    return;
                }

                composeBody.innerText = result.translatedText;
                btn.innerHTML = '✅ Translated!';
                btn.disabled = false;
                setTimeout(() => { btn.innerHTML = '🌐 Translate Reply'; }, 2000);

            } catch (err) {
                btn.innerHTML = '❌ Failed';
                btn.disabled = false;
                setTimeout(() => { btn.innerHTML = '🌐 Translate Reply'; }, 3000);
            }
        });

        wrapper.appendChild(langSelect);
        wrapper.appendChild(btn);
        return wrapper;
    }

    // ── Language Badge ──
    function injectLanguageBadge(emailBody, locale, translated) {
        const existing = emailBody.parentElement.querySelector('.lingo-lang-badge');
        if (existing) existing.remove();

        const badge = document.createElement("span");
        badge.className = "lingo-lang-badge";
        badge.textContent = translated
            ? `🌐 Translated from ${getLanguageName(locale)}`
            : `🌐 ${getLanguageName(locale)} (already in your language)`;
        emailBody.parentElement.insertBefore(badge, emailBody);
    }

    // ── Loading Bar ──
    function createLoadingBar() {
        const bar = document.createElement("div");
        bar.className = "lingo-loading";
        bar.innerHTML = `
      <div class="lingo-loading-inner">
        <div class="lingo-spinner"></div>
        <span>Translating with Lingo-Mail...</span>
      </div>
    `;
        return bar;
    }

    // ── Error Display ──
    function showError(emailBody, message) {
        const existing = emailBody.parentElement.querySelector('.lingo-error');
        if (existing) existing.remove();

        const errDiv = document.createElement("div");
        errDiv.className = "lingo-error";
        errDiv.innerHTML = `
      <span class="lingo-error-icon">⚠️</span>
      <span>${escapeHtml(message)}</span>
    `;
        emailBody.parentElement.insertBefore(errDiv, emailBody);
        setTimeout(() => errDiv.remove(), 10000);
    }

    // ── Utilities ──
    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    function hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function getLanguageName(code) {
        const map = Object.fromEntries(LANGUAGES);
        return map[code] || code;
    }

    // ── Language List ──
    const LANGUAGES = [
        ["en", "English"],
        ["es", "Spanish"],
        ["fr", "French"],
        ["de", "German"],
        ["it", "Italian"],
        ["pt", "Portuguese"],
        ["ru", "Russian"],
        ["zh", "Chinese"],
        ["ja", "Japanese"],
        ["ko", "Korean"],
        ["ar", "Arabic"],
        ["hi", "Hindi"],
        ["bn", "Bengali"],
        ["tr", "Turkish"],
        ["vi", "Vietnamese"],
        ["th", "Thai"],
        ["pl", "Polish"],
        ["nl", "Dutch"],
        ["sv", "Swedish"],
        ["da", "Danish"],
        ["fi", "Finnish"],
        ["no", "Norwegian"],
        ["cs", "Czech"],
        ["ro", "Romanian"],
        ["hu", "Hungarian"],
        ["el", "Greek"],
        ["he", "Hebrew"],
        ["id", "Indonesian"],
        ["ms", "Malay"],
        ["uk", "Ukrainian"],
        ["ta", "Tamil"],
        ["te", "Telugu"],
        ["mr", "Marathi"],
        ["gu", "Gujarati"],
        ["kn", "Kannada"],
    ];

    // Listen for settings changes
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.targetLanguage) {
            settings.targetLanguage = changes.targetLanguage.newValue;
        }
        if (changes.autoTranslate) {
            settings.autoTranslate = changes.autoTranslate.newValue;
        }
    });

    // Kick off
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
