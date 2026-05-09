document.addEventListener('DOMContentLoaded', () => {
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const modelNameInput = document.getElementById('modelName');
  const targetLangInput = document.getElementById('targetLang');
  const splitViewEnabledInput = document.getElementById('splitViewEnabled');
  const enablePromptChunkingInput = document.getElementById('enablePromptChunking');
  const enableBatchConcurrencyInput = document.getElementById('enableBatchConcurrency');
  const enableDebugOverlayInput = document.getElementById('enableDebugOverlay');
  const saveBtn = document.getElementById('saveBtn');
  const translateBtn = document.getElementById('translateBtn');
  const editGlossaryBtn = document.getElementById('editGlossaryBtn');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  chrome.storage.sync.get([
    'apiUrl',
    'apiKey',
    'modelName',
    'targetLang',
    'splitViewEnabled',
    'enablePromptChunking',
    'enableBatchConcurrency',
    'enableDebugOverlay'
  ], (items) => {
    if (items.apiUrl) apiUrlInput.value = items.apiUrl;
    if (items.apiKey) apiKeyInput.value = items.apiKey;
    if (items.modelName) modelNameInput.value = items.modelName;
    if (items.targetLang) targetLangInput.value = items.targetLang;
    splitViewEnabledInput.checked = items.splitViewEnabled !== false;
    enablePromptChunkingInput.checked = items.enablePromptChunking === true;
    enableBatchConcurrencyInput.checked = items.enableBatchConcurrency !== false;
    enableDebugOverlayInput.checked = items.enableDebugOverlay === true;
  });

  function buildSettings() {
    return {
      apiUrl: apiUrlInput.value || 'https://aidp.bytedance.net/api/modelhub/online/v2/crawl',
      apiKey: apiKeyInput.value,
      modelName: modelNameInput.value || 'gpt-5.4-2026-03-05',
      targetLang: targetLangInput.value || '专业而地道的中文',
      splitViewEnabled: splitViewEnabledInput.checked,
      enablePromptChunking: enablePromptChunkingInput.checked,
      enableBatchConcurrency: enableBatchConcurrencyInput.checked,
      enableDebugOverlay: enableDebugOverlayInput.checked
    };
  }

  function saveSettings(onSaved) {
    chrome.storage.sync.set(buildSettings(), () => {
      statusDiv.textContent = 'Settings saved!';
      setTimeout(() => {
        statusDiv.textContent = '';
      }, 2000);
      if (onSaved) {
        onSaved();
      }
    });
  }

  // Save settings
  saveBtn.addEventListener('click', () => {
    saveSettings();
  });

  // Trigger translation
  translateBtn.addEventListener('click', () => {
    saveSettings(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
          return;
        }

        const tabId = tabs[0].id;
        const options = {
          splitViewEnabled: splitViewEnabledInput.checked,
          enableBatchConcurrency: enableBatchConcurrencyInput.checked,
          enableDebugOverlay: enableDebugOverlayInput.checked
        };

        // 动态检查内容脚本是否已注入，如果没注入则动态注入
        // 这样可以解决“安装插件后之前打开的页面没反应，必须刷新”的问题
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => document.documentElement.getAttribute('data-translate-extension-ready') === 'true'
        }, (results) => {
          if (chrome.runtime.lastError || !results || !results[0].result) {
            chrome.scripting.insertCSS({
              target: { tabId: tabId },
              files: ['content.css']
            }, () => {
              chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
              }, () => {
                chrome.tabs.sendMessage(tabId, { action: 'start_translation', options });
                window.close();
              });
            });
          } else {
            chrome.tabs.sendMessage(tabId, { action: 'start_translation', options });
            window.close();
          }
        });
      });
    });
  });

  // Open glossary editor
  editGlossaryBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'glossary.html' });
  });
});
