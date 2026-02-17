// ─── Lingo-Mail Popup Script ───

document.addEventListener("DOMContentLoaded", () => {
    const apiKeyInput = document.getElementById("apiKey");
    const toggleKeyBtn = document.getElementById("toggleApiKey");
    const targetLangSelect = document.getElementById("targetLanguage");
    const autoTranslateCheck = document.getElementById("autoTranslate");
    const saveBtn = document.getElementById("saveBtn");
    const statusMsg = document.getElementById("statusMsg");

    // Load saved settings
    chrome.storage.local.get(
        ["lingoApiKey", "targetLanguage", "autoTranslate"],
        (result) => {
            if (result.lingoApiKey) apiKeyInput.value = result.lingoApiKey;
            if (result.targetLanguage) targetLangSelect.value = result.targetLanguage;
            autoTranslateCheck.checked = result.autoTranslate !== undefined ? result.autoTranslate : true;
        }
    );

    // Toggle API key visibility
    toggleKeyBtn.addEventListener("click", () => {
        if (apiKeyInput.type === "password") {
            apiKeyInput.type = "text";
            toggleKeyBtn.textContent = "🙈";
        } else {
            apiKeyInput.type = "password";
            toggleKeyBtn.textContent = "👁️";
        }
    });

    // Save settings
    saveBtn.addEventListener("click", () => {
        const apiKey = apiKeyInput.value.trim();
        const targetLanguage = targetLangSelect.value;
        const autoTranslate = autoTranslateCheck.checked;

        if (!apiKey) {
            showStatus("Please enter your Lingo.dev API key", "error");
            return;
        }

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="save-icon">⏳</span> Saving...';

        chrome.storage.local.set(
            { lingoApiKey: apiKey, targetLanguage, autoTranslate },
            () => {
                showStatus("Settings saved successfully!", "success");
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<span class="save-icon">✅</span> Saved!';

                setTimeout(() => {
                    saveBtn.innerHTML = '<span class="save-icon">💾</span> Save Settings';
                }, 2000);
            }
        );
    });

    function showStatus(message, type) {
        statusMsg.textContent = message;
        statusMsg.className = `status-msg ${type}`;
        statusMsg.style.display = "block";
        setTimeout(() => {
            statusMsg.style.display = "none";
        }, 4000);
    }
});
