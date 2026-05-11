document.addEventListener('DOMContentLoaded', () => {
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const modelNameInput = document.getElementById('modelName');
  const targetLangInput = document.getElementById('targetLang');
  const inputPricePerMillionInput = document.getElementById('inputPricePerMillion');
  const outputPricePerMillionInput = document.getElementById('outputPricePerMillion');
  const estimatedOutputRatioInput = document.getElementById('estimatedOutputRatio');
  const splitViewEnabledInput = document.getElementById('splitViewEnabled');
  const enablePromptChunkingInput = document.getElementById('enablePromptChunking');
  const enableBatchConcurrencyInput = document.getElementById('enableBatchConcurrency');
  const enableDebugOverlayInput = document.getElementById('enableDebugOverlay');
  const saveBtn = document.getElementById('saveBtn');
  const estimateBtn = document.getElementById('estimateBtn');
  const translateBtn = document.getElementById('translateBtn');
  const editGlossaryBtn = document.getElementById('editGlossaryBtn');
  const estimateResultDiv = document.getElementById('estimateResult');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  chrome.storage.sync.get([
    'apiUrl',
    'apiKey',
    'modelName',
    'targetLang',
    'inputPricePerMillion',
    'outputPricePerMillion',
    'estimatedOutputRatio',
    'splitViewEnabled',
    'enablePromptChunking',
    'enableBatchConcurrency',
    'enableDebugOverlay'
  ], (items) => {
    if (items.apiUrl) apiUrlInput.value = items.apiUrl;
    if (items.apiKey) apiKeyInput.value = items.apiKey;
    if (items.modelName) modelNameInput.value = items.modelName;
    if (items.targetLang) targetLangInput.value = items.targetLang;
    if (items.inputPricePerMillion !== undefined) inputPricePerMillionInput.value = items.inputPricePerMillion;
    if (items.outputPricePerMillion !== undefined) outputPricePerMillionInput.value = items.outputPricePerMillion;
    estimatedOutputRatioInput.value = items.estimatedOutputRatio || '1.2';
    splitViewEnabledInput.checked = items.splitViewEnabled !== false;
    enablePromptChunkingInput.checked = items.enablePromptChunking === true;
    enableBatchConcurrencyInput.checked = items.enableBatchConcurrency !== false;
    enableDebugOverlayInput.checked = items.enableDebugOverlay === true;
  });

  function setStatus(message, isError) {
    statusDiv.textContent = message || '';
    statusDiv.style.color = isError ? '#b91c1c' : '#166534';
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN').format(value);
  }

  function formatMoney(value) {
    if (value === null || value === undefined) {
      return '未配置';
    }
    return `~ ${value.toFixed(4)}`;
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildEstimateSummary(estimate) {
    const lines = [
      '<strong>当前页面预估</strong>',
      `<div class="result-line">页面标题：${escapeHtml(estimate.pageTitle || '未命名页面')}</div>`,
      `<div class="result-line">文本节点数：${formatNumber(estimate.textNodeCount)}</div>`,
      `<div class="result-line">文本字符数：${formatNumber(estimate.textCharacterCount)}</div>`,
      `<div class="result-line">预估输入 Tokens：${formatNumber(estimate.estimatedInputTokens)}</div>`,
      `<div class="result-line">预估输出 Tokens：${formatNumber(estimate.estimatedOutputTokens)}</div>`,
      `<div class="result-line">预估总 Tokens：${formatNumber(estimate.estimatedTotalTokens)}</div>`,
      `<div class="result-line">页面批次数：${formatNumber(estimate.estimatedPageBatchCount)}</div>`,
      `<div class="result-line">大 Prompt 分片数：${formatNumber(estimate.chunkCount)}</div>`,
      `<div class="result-line">预估成本：${formatMoney(estimate.estimatedCost)}</div>`,
      `<div class="result-line">模型：${escapeHtml(estimate.modelName)}</div>`
    ];

    if (estimate.warningMessage) {
      lines.push(`<div class="result-warning">${escapeHtml(estimate.warningMessage)}</div>`);
    }

    return lines.join('');
  }

  function renderEstimate(estimate) {
    estimateResultDiv.hidden = false;
    estimateResultDiv.innerHTML = buildEstimateSummary(estimate);
  }

  function getActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        if (!tabs[0]) {
          reject(new Error('未找到当前标签页'));
          return;
        }
        resolve(tabs[0]);
      });
    });
  }

  function isRestrictedTabUrl(url) {
    if (!url) {
      return true;
    }

    const restrictedPrefixes = [
      'chrome://',
      'chrome-extension://',
      'edge://',
      'about:',
      'view-source:',
      'devtools://'
    ];

    if (restrictedPrefixes.some((prefix) => url.startsWith(prefix))) {
      return true;
    }

    if (url.startsWith('https://chromewebstore.google.com/')) {
      return true;
    }

    if (url.startsWith('https://chrome.google.com/webstore')) {
      return true;
    }

    return false;
  }

  function buildRestrictedPageError(tab) {
    const url = tab && tab.url ? tab.url : '';
    if (isRestrictedTabUrl(url)) {
      return new Error('当前标签页不支持注入扩展脚本，请切换到普通网页后再试。');
    }
    return null;
  }

  async function tryPingContentScript(tabId) {
    try {
      const response = await sendTabMessage(tabId, { action: 'ping' });
      return Boolean(response && response.ready);
    } catch (_) {
      return false;
    }
  }

  function injectContentScript(tabId) {
    return new Promise((resolve, reject) => {
      chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['content.css']
      }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          resolve();
        });
      });
    });
  }

  async function ensureContentScriptReady(tab) {
    const restrictedPageError = buildRestrictedPageError(tab);
    if (restrictedPageError) {
      throw restrictedPageError;
    }

    const tabId = tab.id;
    if (await tryPingContentScript(tabId)) {
      return;
    }

    try {
      await injectContentScript(tabId);
    } catch (error) {
      if (buildRestrictedPageError(tab)) {
        throw buildRestrictedPageError(tab);
      }
      throw error;
    }

    if (await tryPingContentScript(tabId)) {
      return;
    }

    throw new Error('内容脚本注入后仍不可用，请刷新当前页面后重试。');
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(response);
      });
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(response);
      });
    });
  }

  function buildSettings() {
    return {
      apiUrl: apiUrlInput.value || 'https://aidp.bytedance.net/api/modelhub/online/v2/crawl',
      apiKey: apiKeyInput.value,
      modelName: modelNameInput.value || 'gpt-5.4-2026-03-05',
      targetLang: targetLangInput.value || '专业而地道的中文',
      inputPricePerMillion: inputPricePerMillionInput.value,
      outputPricePerMillion: outputPricePerMillionInput.value,
      estimatedOutputRatio: estimatedOutputRatioInput.value || '1.2',
      splitViewEnabled: splitViewEnabledInput.checked,
      enablePromptChunking: enablePromptChunkingInput.checked,
      enableBatchConcurrency: enableBatchConcurrencyInput.checked,
      enableDebugOverlay: enableDebugOverlayInput.checked
    };
  }

  function saveSettings(onSaved) {
    chrome.storage.sync.set(buildSettings(), () => {
      setStatus('Settings saved!', false);
      setTimeout(() => {
        setStatus('', false);
      }, 2000);
      if (onSaved) {
        onSaved();
      }
    });
  }

  async function estimateCurrentPage() {
    setStatus('正在预估当前页面...', false);
    const tab = await getActiveTab();
    await ensureContentScriptReady(tab);

    const pageResponse = await sendTabMessage(tab.id, { action: 'collect_estimate_payload' });
    if (!pageResponse || pageResponse.error) {
      throw new Error(pageResponse && pageResponse.error ? pageResponse.error : '页面采集失败');
    }

    const estimateResponse = await sendRuntimeMessage({
      action: 'estimate_translation_cost',
      payload: pageResponse.estimatePayload
    });

    if (!estimateResponse || estimateResponse.error) {
      throw new Error(estimateResponse && estimateResponse.error ? estimateResponse.error : '预估失败');
    }

    renderEstimate(estimateResponse.estimate);
    setStatus('预估完成', false);
    return {
      tab,
      estimate: estimateResponse.estimate
    };
  }

  function buildTranslateConfirmationMessage(estimate) {
    const lines = [
      `页面：${estimate.pageTitle || '未命名页面'}`,
      `文本节点：${estimate.textNodeCount}`,
      `预估输入 Tokens：${estimate.estimatedInputTokens}`,
      `预估输出 Tokens：${estimate.estimatedOutputTokens}`,
      `预估总 Tokens：${estimate.estimatedTotalTokens}`,
      `大 Prompt 分片数：${estimate.chunkCount}`,
      `页面批次数：${estimate.estimatedPageBatchCount}`,
      `预估成本：${formatMoney(estimate.estimatedCost)}`
    ];

    if (estimate.warningMessage) {
      lines.push('', `提示：${estimate.warningMessage}`);
    }

    lines.push('', '确认继续翻译吗？');
    return lines.join('\n');
  }

  // Save settings
  saveBtn.addEventListener('click', () => {
    saveSettings();
  });

  estimateBtn.addEventListener('click', () => {
    saveSettings(async () => {
      try {
        await estimateCurrentPage();
      } catch (error) {
        console.error('Estimate failed:', error);
        setStatus(`预估失败：${error.message}`, true);
      }
    });
  });

  // Trigger translation
  translateBtn.addEventListener('click', () => {
    saveSettings(async () => {
      try {
        const { tab, estimate } = await estimateCurrentPage();
        if (estimate.textNodeCount === 0) {
          setStatus('当前页面未找到可翻译文本', true);
          return;
        }

        const shouldContinue = window.confirm(buildTranslateConfirmationMessage(estimate));
        if (!shouldContinue) {
          setStatus('已取消翻译，你可以先调整模型或价格配置', false);
          return;
        }

        const options = {
          splitViewEnabled: splitViewEnabledInput.checked,
          enableBatchConcurrency: enableBatchConcurrencyInput.checked,
          enableDebugOverlay: enableDebugOverlayInput.checked
        };

        await ensureContentScriptReady(tab);
        await sendTabMessage(tab.id, { action: 'start_translation', options });
        window.close();
      } catch (error) {
        console.error('Translate failed before start:', error);
        setStatus(`翻译前预估失败：${error.message}`, true);
      }
    });
  });

  // Open glossary editor
  editGlossaryBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'glossary.html' });
  });
});
