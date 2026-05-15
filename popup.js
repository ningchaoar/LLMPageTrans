document.addEventListener('DOMContentLoaded', () => {
  const endpointSelect = document.getElementById('endpointSelect');
  const endpointDescription = document.getElementById('endpointDescription');
  const endpointSummary = document.getElementById('endpointSummary');
  const estimatedOutputRatioInput = document.getElementById('estimatedOutputRatio');
  const splitViewEnabledInput = document.getElementById('splitViewEnabled');
  const enablePromptChunkingInput = document.getElementById('enablePromptChunking');
  const enableBatchConcurrencyInput = document.getElementById('enableBatchConcurrency');
  const enableDebugOverlayInput = document.getElementById('enableDebugOverlay');
  const enableBrutalTestModeInput = document.getElementById('enableBrutalTestMode');
  const manageEndpointsBtn = document.getElementById('manageEndpointsBtn');
  const saveBtn = document.getElementById('saveBtn');
  const estimateBtn = document.getElementById('estimateBtn');
  const translateBtn = document.getElementById('translateBtn');
  const editGlossaryBtn = document.getElementById('editGlossaryBtn');
  const estimateResultDiv = document.getElementById('estimateResult');
  const statusDiv = document.getElementById('status');

  let endpointsState = normalizeEndpointsState(null);

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

  function chromeStorageGet(area, keys) {
    return new Promise((resolve, reject) => {
      chrome.storage[area].get(keys, (items) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(items);
      });
    });
  }

  function chromeStorageSet(area, items) {
    return new Promise((resolve, reject) => {
      chrome.storage[area].set(items, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  }

  function chromeStorageRemove(area, keys) {
    return new Promise((resolve, reject) => {
      chrome.storage[area].remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  }

  function getCurrentEndpoint() {
    return findEndpointById(endpointsState, endpointSelect.value || endpointsState.currentEndpointId);
  }

  function renderEndpointOptions() {
    endpointSelect.innerHTML = '';

    endpointsState.endpoints.forEach((endpoint) => {
      const option = document.createElement('option');
      option.value = endpoint.id;
      option.textContent = endpoint.name || '未命名接入点';
      endpointSelect.appendChild(option);
    });

    endpointSelect.value = endpointsState.currentEndpointId;
  }

  function renderEndpointSummary(endpoint) {
    if (!endpoint) {
      endpointDescription.textContent = '当前没有可用接入点，请先创建。';
      endpointSummary.innerHTML = '<strong>未配置接入点</strong><div class="result-line">请点击 Manage Endpoints 创建模型接入点。</div>';
      return;
    }

    const definition = getProviderDefinition(endpoint.mode);
    endpointDescription.textContent = definition.description;
    endpointSummary.innerHTML = [
      '<strong>当前接入点</strong>',
      `<div class="result-line">名称：${escapeHtml(endpoint.name)}</div>`,
      `<div class="result-line">模式：${escapeHtml(definition.label)}</div>`,
      `<div class="result-line">模型：${escapeHtml(endpoint.modelName || '未配置')}</div>`,
      `<div class="result-line">语言：${escapeHtml(endpoint.targetLang || DEFAULT_ENDPOINT_TARGET_LANGUAGE)}</div>`,
      `<div class="result-line">URL：${escapeHtml(endpoint.baseUrl || '未配置')}</div>`
    ].join('');
  }

  function buildEstimateSummary(estimate) {
    const lines = [
      '<strong>当前页面预估</strong>',
      `<div class="result-line">页面标题：${escapeHtml(estimate.pageTitle || '未命名页面')}</div>`,
      `<div class="result-line">接入点：${escapeHtml(estimate.endpointName || '未命名接入点')}</div>`,
      `<div class="result-line">模式：${escapeHtml(estimate.providerLabel || estimate.providerId || '未知')}</div>`,
      `<div class="result-line">文本节点数：${formatNumber(estimate.textNodeCount)}</div>`,
      `<div class="result-line">文本字符数：${formatNumber(estimate.textCharacterCount)}</div>`,
      `<div class="result-line">预估输入 Tokens：${formatNumber(estimate.estimatedInputTokens)}</div>`,
      `<div class="result-line">预估输出 Tokens：${formatNumber(estimate.estimatedOutputTokens)}</div>`,
      `<div class="result-line">预估总 Tokens：${formatNumber(estimate.estimatedTotalTokens)}</div>`,
      `<div class="result-line">页面批次数：${formatNumber(estimate.estimatedPageBatchCount)}</div>`,
      `<div class="result-line">大 Prompt 分片数：${formatNumber(estimate.chunkCount)}</div>`,
      `<div class="result-line">预估成本：${formatMoney(estimate.estimatedCost)}</div>`,
      `<div class="result-line">模型：${escapeHtml(estimate.modelName)}</div>`,
      `<div class="result-line">暴力测试模式：${estimate.brutalTestModeEnabled ? '开启' : '关闭'}</div>`
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

  function openPdfViewerForTab(tab, pdfSource) {
    const viewerUrl = chrome.runtime.getURL(
      `pdf-viewer.html?source=${encodeURIComponent(pdfSource)}&title=${encodeURIComponent(tab.title || 'PDF')}`
    );
    chrome.tabs.create({ url: viewerUrl });
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
        target: { tabId },
        files: ['content.css']
      }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        chrome.scripting.executeScript({
          target: { tabId },
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
      const currentRestrictedPageError = buildRestrictedPageError(tab);
      if (currentRestrictedPageError) {
        throw currentRestrictedPageError;
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

  async function savePreferences() {
    const endpoint = getCurrentEndpoint();
    if (!endpoint) {
      throw new Error('请先创建并选择一个模型接入点。');
    }

    endpointsState.currentEndpointId = endpointSelect.value;

    await chromeStorageSet('local', {
      [ENDPOINTS_STORAGE_KEY]: endpointsState
    });

    await chromeStorageSet('sync', {
      estimatedOutputRatio: estimatedOutputRatioInput.value || '1.2',
      splitViewEnabled: splitViewEnabledInput.checked,
      enablePromptChunking: enablePromptChunkingInput.checked,
      enableBatchConcurrency: enableBatchConcurrencyInput.checked,
      enableDebugOverlay: enableDebugOverlayInput.checked,
      enableBrutalTestMode: enableBrutalTestModeInput.checked
    });

    await chromeStorageRemove('sync', [
      'selectedProvider',
      'providers',
      'apiUrl',
      'apiKey',
      'modelName',
      'targetLang',
      'inputPricePerMillion',
      'outputPricePerMillion'
    ]);

    setStatus('Preferences saved!', false);
    setTimeout(() => {
      setStatus('', false);
    }, 2000);
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
      `接入点：${estimate.endpointName || '未命名接入点'}`,
      `模式：${estimate.providerLabel || estimate.providerId || '未知'}`,
      `文本节点：${estimate.textNodeCount}`,
      `预估输入 Tokens：${estimate.estimatedInputTokens}`,
      `预估输出 Tokens：${estimate.estimatedOutputTokens}`,
      `预估总 Tokens：${estimate.estimatedTotalTokens}`,
      `大 Prompt 分片数：${estimate.chunkCount}`,
      `页面批次数：${estimate.estimatedPageBatchCount}`,
      `预估成本：${formatMoney(estimate.estimatedCost)}`,
      `暴力测试模式：${estimate.brutalTestModeEnabled ? '开启' : '关闭'}`
    ];

    if (estimate.warningMessage) {
      lines.push('', `提示：${estimate.warningMessage}`);
    }

    lines.push('', '确认继续翻译吗？');
    return lines.join('\n');
  }

  async function loadInitialState() {
    const [localItems, syncItems] = await Promise.all([
      chromeStorageGet('local', [ENDPOINTS_STORAGE_KEY]),
      chromeStorageGet('sync', [
        'selectedProvider',
        'providers',
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
        'enableDebugOverlay',
        'enableBrutalTestMode'
      ])
    ]);

    endpointsState = localItems[ENDPOINTS_STORAGE_KEY]
      ? normalizeEndpointsState(localItems[ENDPOINTS_STORAGE_KEY])
      : buildLegacyEndpointsState(syncItems);

    estimatedOutputRatioInput.value = syncItems.estimatedOutputRatio || '1.2';
    splitViewEnabledInput.checked = syncItems.splitViewEnabled !== false;
    enablePromptChunkingInput.checked = syncItems.enablePromptChunking === true;
    enableBatchConcurrencyInput.checked = syncItems.enableBatchConcurrency !== false;
    enableDebugOverlayInput.checked = syncItems.enableDebugOverlay === true;
    enableBrutalTestModeInput.checked = syncItems.enableBrutalTestMode === true;

    renderEndpointOptions();
    renderEndpointSummary(getCurrentEndpoint());
  }

  endpointSelect.addEventListener('change', () => {
    endpointsState.currentEndpointId = endpointSelect.value;
    renderEndpointSummary(getCurrentEndpoint());
    estimateResultDiv.hidden = true;
  });

  manageEndpointsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'endpoints.html' });
  });

  saveBtn.addEventListener('click', async () => {
    try {
      await savePreferences();
    } catch (error) {
      console.error('Save preferences failed:', error);
      setStatus(`保存失败：${error.message}`, true);
    }
  });

  estimateBtn.addEventListener('click', async () => {
    try {
      await savePreferences();
      const tab = await getActiveTab();
      const pdfSource = PdfSourceUtils.extractPdfSourceFromTab(tab);
      if (pdfSource) {
        openPdfViewerForTab(tab, pdfSource);
        window.close();
        return;
      }
      await estimateCurrentPage();
    } catch (error) {
      console.error('Estimate failed:', error);
      setStatus(`预估失败：${error.message}`, true);
    }
  });

  translateBtn.addEventListener('click', async () => {
    try {
      await savePreferences();
      const activeTab = await getActiveTab();
      const pdfSource = PdfSourceUtils.extractPdfSourceFromTab(activeTab);
      if (pdfSource) {
        openPdfViewerForTab(activeTab, pdfSource);
        window.close();
        return;
      }

      const { tab, estimate } = await estimateCurrentPage();
      if (estimate.textNodeCount === 0) {
        setStatus('当前页面未找到可翻译文本', true);
        return;
      }

      const shouldContinue = window.confirm(buildTranslateConfirmationMessage(estimate));
      if (!shouldContinue) {
        setStatus('已取消翻译，你可以先调整接入点或参数', false);
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

  editGlossaryBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'glossary.html' });
  });

  loadInitialState().catch((error) => {
    console.error('Load popup state failed:', error);
    setStatus(`初始化失败：${error.message}`, true);
  });
});
