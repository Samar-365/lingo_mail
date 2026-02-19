// ─── Lingo-Mail Content Script ───
// Interacts with Gmail DOM to detect emails, inject translations, summarization, and handle reply translation

(function () {
    "use strict";

    // ── State ──
    const translatedEmails = new Map();
    const summarizedEmails = new Map();
    let observerActive = false;
    let currentReadAloudBtn = null; // Track active read-aloud button
    let settings = { targetLanguage: "en", autoTranslate: true };

    // ── Initialization ──
    async function init() {
        // Configure pdf.js to use fake worker (both scripts loaded in same scope)
        if (typeof pdfjsLib !== "undefined") {
            pdfjsLib.GlobalWorkerOptions.workerSrc = "";
        }

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
            processAttachments();
        }, 500));

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        setTimeout(() => {
            processEmailView();
            processComposeWindow();
            processAttachments();
        }, 2000);
    }

    // ── Process Email View ──
    // Only translates the currently opened/expanded email to conserve API usage.
    // Collapsed emails in a Gmail thread have zero offsetHeight and are skipped.
    function processEmailView() {
        const emailBodies = document.querySelectorAll(
            'div.a3s.aiL, div[data-message-id] div.a3s'
        );

        emailBodies.forEach((emailBody) => {
            if (emailBody.dataset.lingoProcessed) return;

            // Skip emails that are collapsed / not visible (saves API calls)
            if (emailBody.offsetHeight === 0) return;

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

        const loadingBar = createLoadingBar("Translating with Lingo-Mail...");
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
                // Still inject summarize button even if already in target language
                injectSummarizeButton(emailBody, messageId);
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

        const btnGroup = document.createElement("div");
        btnGroup.className = "lingo-btn-group";

        const toggleBtn = document.createElement("button");
        toggleBtn.className = "lingo-toggle-btn";
        toggleBtn.textContent = "Show Original";
        toggleBtn.addEventListener("click", () => {
            toggleTranslation(emailBody, messageId, toggleBtn);
        });

        // Summarize button in the header
        const summarizeBtn = document.createElement("button");
        summarizeBtn.className = "lingo-summarize-btn";
        summarizeBtn.innerHTML = "✨ Summarize";
        summarizeBtn.addEventListener("click", () => {
            handleSummarize(emailBody, messageId, summarizeBtn);
        });

        // Read Aloud button in the header
        const readAloudBtn = document.createElement("button");
        readAloudBtn.className = "lingo-read-aloud-btn";
        readAloudBtn.innerHTML = "🔊 Read Aloud";
        readAloudBtn.addEventListener("click", () => {
            handleReadAloud(emailBody, messageId, readAloudBtn);
        });

        btnGroup.appendChild(toggleBtn);
        btnGroup.appendChild(summarizeBtn);
        btnGroup.appendChild(readAloudBtn);

        header.appendChild(langInfo);
        header.appendChild(btnGroup);

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
        // Find or create action row
        let actionRow = emailBody.parentElement.querySelector('.lingo-action-row');
        if (!actionRow) {
            actionRow = document.createElement("div");
            actionRow.className = "lingo-action-row";
            emailBody.parentElement.insertBefore(actionRow, emailBody);
        }

        if (actionRow.querySelector('.lingo-manual-btn')) return;

        const btn = document.createElement("button");
        btn.className = "lingo-manual-btn";
        btn.innerHTML = '🌐 Translate Email';
        btn.addEventListener("click", () => {
            btn.remove();
            // If row is empty after button removal, should we remove it? 
            // Better to leave if PDF buttons might be there.
            if (actionRow.children.length === 0) actionRow.remove();
            translateEmailBody(emailBody, messageId);
        });

        actionRow.appendChild(btn);
    }



    // ── Handle Summarize Click ──
    async function handleSummarize(emailBody, messageId, btn) {
        // Check if already summarized
        if (summarizedEmails.has(messageId)) {
            const existing = emailBody.parentElement.querySelector('.lingo-summary-block');
            if (existing) {
                existing.style.display = existing.style.display === "none" ? "" : "none";
                return;
            }
        }

        // Prefer translated text over original for summarization
        const translatedEl = emailBody.parentElement.querySelector('.lingo-translated-content');
        const textToSummarize = translatedEl?.innerText?.trim() || emailBody.innerText?.trim() || "";

        if (!textToSummarize || textToSummarize.length < 10) return;

        btn.disabled = true;
        const originalLabel = btn.innerHTML;
        btn.innerHTML = '⏳ Summarizing...';

        try {
            const result = await chrome.runtime.sendMessage({
                action: "summarize",
                text: textToSummarize.substring(0, 3000), // Limit to avoid token overflow
                language: settings.targetLanguage || "en",
            });

            if (result?.error) {
                btn.innerHTML = '❌ Error';
                setTimeout(() => { btn.innerHTML = originalLabel; btn.disabled = false; }, 3000);
                showError(emailBody, result.error);
                return;
            }

            summarizedEmails.set(messageId, result.summary);
            injectSummaryBlock(emailBody, messageId, result.summary);

            btn.innerHTML = '✨ Summarize';
            btn.disabled = false;

        } catch (err) {
            btn.innerHTML = '❌ Failed';
            btn.disabled = false;
            setTimeout(() => { btn.innerHTML = originalLabel; }, 3000);
            showError(emailBody, err.message);
        }
    }

    // ── Inject Summary Block ──
    function injectSummaryBlock(emailBody, messageId, summary) {
        const existing = emailBody.parentElement.querySelector('.lingo-summary-block');
        if (existing) existing.remove();

        const block = document.createElement("div");
        block.className = "lingo-summary-block";

        const header = document.createElement("div");
        header.className = "lingo-summary-header";

        const title = document.createElement("span");
        title.className = "lingo-summary-title";
        title.innerHTML = '✨ AI Summary';

        const closeBtn = document.createElement("button");
        closeBtn.className = "lingo-summary-close";
        closeBtn.textContent = "✕";
        closeBtn.addEventListener("click", () => {
            block.style.display = "none";
        });

        header.appendChild(title);
        header.appendChild(closeBtn);

        const content = document.createElement("div");
        content.className = "lingo-summary-content";
        content.textContent = summary;

        block.appendChild(header);
        block.appendChild(content);

        // Insert after the translation block if it exists, otherwise after the email body
        const translationBlock = emailBody.parentElement.querySelector('.lingo-translation-block');
        if (translationBlock) {
            translationBlock.after(block);
        } else {
            emailBody.after(block);
        }
    }

    // ── Handle Read Aloud Click ──
    function handleReadAloud(emailBody, messageId, btn) {
        // If already speaking, stop
        if (window.speechSynthesis.speaking) {
            stopReadAloud();
            return;
        }

        // Get the translated text
        const translatedEl = emailBody.parentElement.querySelector('.lingo-translated-content');
        const textToRead = translatedEl?.innerText?.trim() || emailBody.innerText?.trim() || "";

        if (!textToRead || textToRead.length < 5) return;

        const utterance = new SpeechSynthesisUtterance(textToRead);

        // Set language for correct pronunciation
        const data = translatedEmails.get(messageId);
        if (data?.targetLocale) {
            utterance.lang = data.targetLocale;
        } else {
            utterance.lang = settings.targetLanguage || "en";
        }

        utterance.rate = 1;
        utterance.pitch = 1;

        // Update button state
        btn.innerHTML = "⏹️ Stop Reading";
        btn.classList.add("speaking");
        currentReadAloudBtn = btn;

        utterance.onend = () => {
            btn.innerHTML = "🔊 Read Aloud";
            btn.classList.remove("speaking");
            currentReadAloudBtn = null;
        };

        utterance.onerror = () => {
            btn.innerHTML = "🔊 Read Aloud";
            btn.classList.remove("speaking");
            currentReadAloudBtn = null;
        };

        window.speechSynthesis.speak(utterance);
    }

    // ── Stop Read Aloud ──
    function stopReadAloud() {
        window.speechSynthesis.cancel();
        if (currentReadAloudBtn) {
            currentReadAloudBtn.innerHTML = "🔊 Read Aloud";
            currentReadAloudBtn.classList.remove("speaking");
            currentReadAloudBtn = null;
        }
    }

    // ── Process Attachments (PDF Translation) ──
    function processAttachments() {
        if (typeof pdfjsLib === "undefined") return;

        // Gmail attachment cards — multiple selector strategies for resilience
        const attachmentCards = document.querySelectorAll(
            'div.aQH span.aZo, div.aQH div.aZo, div[download_url], span.aZo'
        );

        attachmentCards.forEach((card) => {
            if (card.dataset.lingoPdfProcessed) return;

            // Check if this is a PDF attachment
            const filename = getAttachmentFilename(card);
            if (!filename || !filename.toLowerCase().endsWith('.pdf')) return;

            card.dataset.lingoPdfProcessed = "true";
            const btn = injectPdfTranslateButton(card, filename);

            // Auto-translate if setting is on
            if (settings.autoTranslate && btn) {
                handlePdfTranslate(card, filename, btn);
            }
        });
    }

    // ── Get Attachment Filename ──
    function getAttachmentFilename(card) {
        // Try download_url attribute first
        const downloadUrl = card.getAttribute('download_url');
        if (downloadUrl) {
            // Format: "mime:filename:url"
            const parts = downloadUrl.split(':');
            if (parts.length >= 2) return parts[1];
        }

        // Try finding filename text within the card
        const nameEl = card.querySelector('.aV3, .aQA span, [data-tooltip]');
        if (nameEl) {
            return nameEl.textContent?.trim() || nameEl.getAttribute('data-tooltip') || '';
        }

        // Try aria-label
        const ariaLabel = card.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel;

        return card.textContent?.trim()?.split('\n')[0] || '';
    }

    // ── Get Attachment Download URL ──
    function getAttachmentDownloadUrl(card) {
        // Try download_url attribute
        const downloadUrlAttr = card.getAttribute('download_url');
        if (downloadUrlAttr) {
            const colonIdx = downloadUrlAttr.indexOf(':', downloadUrlAttr.indexOf(':') + 1);
            if (colonIdx > -1) {
                return downloadUrlAttr.substring(colonIdx + 1);
            }
        }

        // Try finding a download link within or near the card
        const parentContainer = card.closest('.aQH') || card.parentElement;
        const downloadLink = parentContainer?.querySelector('a[href*="mail.google.com"][href*="&view=att"]') ||
            parentContainer?.querySelector('a[download]') ||
            card.querySelector('a[href]');

        if (downloadLink) return downloadLink.href;

        // Try the card itself if it's a link
        if (card.tagName === 'A') return card.href;

        return null;
    }

    // ── Inject PDF Translate Button ──
    function injectPdfTranslateButton(card, filename) {
        // Find unique ID to prevent duplicates for this file
        // We use the card itself to track status via dataset
        if (card.dataset.lingoButtonInjected === "true") return null;

        // Find the email body element near this attachment
        const messageRoot = card.closest('.gs') || card.closest('[data-message-id]') || card.closest('.adn');
        if (!messageRoot) return null;

        const emailBody = messageRoot.querySelector('div.a3s.aiL') || messageRoot.querySelector('div.a3s');
        if (!emailBody) return null;

        // Find or create action row
        let actionRow = emailBody.parentElement.querySelector('.lingo-action-row');
        if (!actionRow) {
            actionRow = document.createElement("div");
            actionRow.className = "lingo-action-row";
            emailBody.parentElement.insertBefore(actionRow, emailBody);
        }

        const btn = document.createElement("button");
        btn.className = "lingo-pdf-btn";
        btn.innerHTML = "📄 Translate PDF";
        btn.title = `Translate ${filename}`;
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            handlePdfTranslate(card, filename, btn);
        });

        actionRow.appendChild(btn);
        card.dataset.lingoButtonInjected = "true";
        return btn;
    }

    // ── Handle PDF Translate ──
    async function handlePdfTranslate(card, filename, btn) {
        btn.disabled = true;
        btn.innerHTML = "⏳ Extracting text...";

        try {
            // Step 1: Get download URL
            const downloadUrl = getAttachmentDownloadUrl(card);
            if (!downloadUrl) {
                throw new Error("Could not find PDF download URL. Try downloading the PDF first, then use the translate button.");
            }

            // Step 2: Fetch the PDF
            btn.innerHTML = "⏳ Downloading PDF...";
            const response = await fetch(downloadUrl, { credentials: "include" });
            if (!response.ok) {
                throw new Error(`Failed to download PDF (${response.status})`);
            }
            const arrayBuffer = await response.arrayBuffer();

            // Step 3: Extract text with pdf.js
            btn.innerHTML = "⏳ Extracting text...";
            const extractedText = await extractPdfText(arrayBuffer);

            if (!extractedText || extractedText.trim().length < 5) {
                throw new Error("Could not extract text from PDF. The PDF may contain only images or scanned content.");
            }

            // Step 4: Translate
            btn.innerHTML = "⏳ Translating...";
            const result = await chrome.runtime.sendMessage({
                action: "translatePdfText",
                text: extractedText.substring(0, 10000), // Limit to avoid excessive API usage
                targetLocale: settings.targetLanguage,
            });

            if (result?.error) {
                throw new Error(result.error);
            }

            // Step 5: Show modal
            showPdfTranslationModal(extractedText, result.translatedText, filename, result.targetLocale);

            btn.innerHTML = "📄 Translate PDF";
            btn.disabled = false;

        } catch (err) {
            btn.innerHTML = "❌ Failed";
            btn.disabled = false;
            setTimeout(() => { btn.innerHTML = "📄 Translate PDF"; }, 3000);

            // Show error near the attachment
            const container = card.closest('.aQH') || card.parentElement;
            if (container) {
                const errDiv = document.createElement("div");
                errDiv.className = "lingo-error";
                errDiv.innerHTML = `<span class="lingo-error-icon">⚠️</span><span>${escapeHtml(err.message)}</span>`;
                container.appendChild(errDiv);
                setTimeout(() => errDiv.remove(), 8000);
            }
        }
    }

    // ── Extract Text from PDF using pdf.js ──
    async function extractPdfText(arrayBuffer) {
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const textParts = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((item) => item.str)
                .join(" ");
            if (pageText.trim()) {
                textParts.push(pageText);
            }
        }

        return textParts.join("\n\n");
    }

    // ── Show PDF Translation Modal ──
    function showPdfTranslationModal(originalText, translatedText, filename, targetLocale) {
        // Remove any existing modal
        closePdfModal();

        const overlay = document.createElement("div");
        overlay.className = "lingo-pdf-modal-overlay";
        overlay.id = "lingoPdfModal";

        const modal = document.createElement("div");
        modal.className = "lingo-pdf-modal";

        // Header
        const header = document.createElement("div");
        header.className = "lingo-pdf-modal-header";
        header.innerHTML = `
            <div class="lingo-pdf-modal-title">
                <span class="lingo-icon">📄</span>
                <span>${escapeHtml(filename)} — Translated to <strong>${getLanguageName(targetLocale)}</strong></span>
            </div>
            <div class="lingo-pdf-modal-actions">
                <button class="lingo-pdf-copy-btn" id="lingoPdfCopyBtn">📋 Copy Translation</button>
                <button class="lingo-pdf-close-btn" id="lingoPdfCloseBtn">✕</button>
            </div>
        `;

        // Tab bar
        const tabBar = document.createElement("div");
        tabBar.className = "lingo-pdf-tab-bar";
        tabBar.innerHTML = `
            <button class="lingo-pdf-tab active" data-tab="translated">🌐 Translated</button>
            <button class="lingo-pdf-tab" data-tab="original">📝 Original</button>
        `;

        // Content
        const content = document.createElement("div");
        content.className = "lingo-pdf-modal-content";

        const translatedPanel = document.createElement("div");
        translatedPanel.className = "lingo-pdf-panel active";
        translatedPanel.dataset.panel = "translated";
        translatedPanel.textContent = translatedText;

        const originalPanel = document.createElement("div");
        originalPanel.className = "lingo-pdf-panel";
        originalPanel.dataset.panel = "original";
        originalPanel.textContent = originalText;

        content.appendChild(translatedPanel);
        content.appendChild(originalPanel);

        modal.appendChild(header);
        modal.appendChild(tabBar);
        modal.appendChild(content);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Event listeners
        overlay.querySelector("#lingoPdfCloseBtn").addEventListener("click", closePdfModal);
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closePdfModal();
        });

        overlay.querySelector("#lingoPdfCopyBtn").addEventListener("click", () => {
            navigator.clipboard.writeText(translatedText).then(() => {
                const copyBtn = overlay.querySelector("#lingoPdfCopyBtn");
                copyBtn.innerHTML = "✅ Copied!";
                setTimeout(() => { copyBtn.innerHTML = "📋 Copy Translation"; }, 2000);
            });
        });

        // Tab switching
        tabBar.querySelectorAll(".lingo-pdf-tab").forEach((tab) => {
            tab.addEventListener("click", () => {
                tabBar.querySelectorAll(".lingo-pdf-tab").forEach(t => t.classList.remove("active"));
                content.querySelectorAll(".lingo-pdf-panel").forEach(p => p.classList.remove("active"));
                tab.classList.add("active");
                content.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("active");
            });
        });

        // Escape key to close
        const escHandler = (e) => {
            if (e.key === "Escape") {
                closePdfModal();
                document.removeEventListener("keydown", escHandler);
            }
        };
        document.addEventListener("keydown", escHandler);
    }

    // ── Close PDF Modal ──
    function closePdfModal() {
        const existing = document.getElementById("lingoPdfModal");
        if (existing) existing.remove();
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
    function createLoadingBar(message) {
        const bar = document.createElement("div");
        bar.className = "lingo-loading";
        bar.innerHTML = `
      <div class="lingo-loading-inner">
        <div class="lingo-spinner"></div>
        <span>${message || "Processing..."}</span>
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
