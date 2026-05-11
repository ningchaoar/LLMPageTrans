let isTranslating = false;
let currentIframe = null;
let currentIframeReady = false;
let scrollSyncBound = false;
let currentSplitViewEnabled = true;
let currentDebugEnabled = false;
let currentDebugState = null;
const BATCH_CONCURRENCY_LIMIT = 6;
document.documentElement.setAttribute('data-translate-extension-ready', 'true');

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'start_translation') {
    if (!isTranslating) {
      startTranslation(request.options || {});
    }
    return;
  }

  if (request.action === 'ping') {
    sendResponse({ ready: true });
    return;
  }

  if (request.action === 'collect_estimate_payload') {
    try {
      const estimatePayload = collectEstimatePayload();
      sendResponse({ estimatePayload });
    } catch (error) {
      console.error('Estimate collection error:', error);
      sendResponse({ error: error.message });
    }
  }
});

async function startTranslation(options) {
  isTranslating = true;
  const splitViewEnabled = options.splitViewEnabled !== false;
  const enableBatchConcurrency = options.enableBatchConcurrency !== false;
  currentDebugEnabled = options.enableDebugOverlay === true;
  currentSplitViewEnabled = splitViewEnabled;
  cleanupExistingTranslation();
  currentDebugState = {
    status: '准备翻译',
    startedAt: Date.now(),
    splitViewEnabled,
    batchMode: enableBatchConcurrency ? '并发' : '串行',
    textNodeCount: 0,
    batchCount: 0,
    completedBatches: 0,
    totalBatches: 0,
    durationMs: 0,
    errorMessage: ''
  };

  // Create loading indicator
  const loading = document.createElement('div');
  loading.id = 'translate-extension-loading';
  loading.textContent = '准备翻译...';
  document.body.appendChild(loading);
  renderDebugOverlay();

  // 2. Clone page into iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'translate-extension-iframe';
  currentIframe = iframe;
  currentIframeReady = false;
  
  // 关键修复：禁用 iframe 内的 JavaScript 执行，防止 React/Next.js 等框架在克隆页中崩溃
  // 只保留同源访问权限（以便我们修改文本），不允许 allow-scripts
  iframe.sandbox = 'allow-same-origin allow-forms allow-popups';
  
  // We need to construct the HTML for the iframe
  // Inject a <base> tag to fix relative URLs
  let htmlContent = document.documentElement.outerHTML;
  const baseTag = `<base href="${window.location.href}">`;
  
  // Insert base tag right after <head>
  if (htmlContent.includes('<head>')) {
    htmlContent = htmlContent.replace('<head>', `<head>${baseTag}`);
  } else {
    htmlContent = `<head>${baseTag}</head>` + htmlContent;
  }

  iframe.srcdoc = htmlContent;
  document.body.appendChild(iframe);
  applyDisplayMode(splitViewEnabled);

  iframe.onload = async () => {
    currentIframeReady = true;
    // 3. Extract text from iframe
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    
    // Clean up iframe DOM so it doesn't nest or shrink
    iframeDoc.documentElement.classList.remove('llm-translator-split');
    const nestedIframe = iframeDoc.getElementById('translate-extension-iframe');
    if (nestedIframe) nestedIframe.remove();
    const nestedLoading = iframeDoc.getElementById('translate-extension-loading');
    if (nestedLoading) nestedLoading.remove();
    iframeDoc.documentElement.removeAttribute('data-translate-extension-ready');

    // Setup scroll synchronization between main window and iframe
    if (currentSplitViewEnabled && !scrollSyncBound) {
      setupScrollSync(window, iframe.contentWindow);
      scrollSyncBound = true;
    }

    const textNodes = extractTextNodes(iframeDoc.body);
    updateDebugState({
      status: '已抽取文本',
      textNodeCount: textNodes.length
    });
    
    if (textNodes.length === 0) {
      loading.textContent = '未找到可翻译文本';
      updateDebugState({
        status: '未找到可翻译文本',
        durationMs: Date.now() - currentDebugState.startedAt
      });
      setTimeout(() => loading.remove(), 2000);
      isTranslating = false;
      return;
    }

    // 4. Send to background script for translation in batches
    try {
      await translateInBatches(textNodes, loading, {
        enableBatchConcurrency,
        onProgress: ({ completed, total, mode }) => {
          updateDebugState({
            status: completed === total ? '回写译文中' : '翻译处理中',
            completedBatches: completed,
            totalBatches: total,
            batchMode: mode
          });
        }
      });
      loading.textContent = '翻译完成';
      loading.style.background = '#4caf50';
      updateDebugState({
        status: '翻译完成',
        completedBatches: currentDebugState.totalBatches,
        durationMs: Date.now() - currentDebugState.startedAt
      });
      setTimeout(() => loading.remove(), 3000);
      isTranslating = false;
    } catch (err) {
      console.error('Translation error:', err);
      loading.textContent = 'Error: ' + err.message;
      loading.style.background = '#f44336';
      updateDebugState({
        status: '翻译失败',
        errorMessage: err.message,
        durationMs: Date.now() - currentDebugState.startedAt
      });
      isTranslating = false;
    }
  };
}

function cleanupExistingTranslation() {
  document.documentElement.classList.remove('llm-translator-split');
  currentIframe = null;
  currentIframeReady = false;
  currentSplitViewEnabled = true;
  currentDebugState = null;
  scrollSyncBound = false;

  const existingIframe = document.getElementById('translate-extension-iframe');
  if (existingIframe) {
    existingIframe.remove();
  }

  const existingLoading = document.getElementById('translate-extension-loading');
  if (existingLoading) {
    existingLoading.remove();
  }

  const toggleButton = document.getElementById('translate-extension-toggle-view');
  if (toggleButton) {
    toggleButton.remove();
  }

  const debugOverlay = document.getElementById('translate-extension-debug');
  if (debugOverlay) {
    debugOverlay.remove();
  }
}

function applyDisplayMode(splitViewEnabled) {
  currentSplitViewEnabled = splitViewEnabled;
  document.documentElement.classList.toggle('llm-translator-split', splitViewEnabled);

  if (currentIframe) {
    currentIframe.classList.toggle('translate-extension-fullscreen', !splitViewEnabled);
  }

  if (splitViewEnabled && currentIframeReady && currentIframe && currentIframe.contentWindow && !scrollSyncBound) {
    setupScrollSync(window, currentIframe.contentWindow);
    scrollSyncBound = true;
  }

  updateViewToggleButton();
}

function updateViewToggleButton() {
  let button = document.getElementById('translate-extension-toggle-view');

  if (!currentIframe) {
    if (button) {
      button.remove();
    }
    return;
  }

  if (!button) {
    button = document.createElement('button');
    button.id = 'translate-extension-toggle-view';
    button.addEventListener('click', () => {
      // Toggle view mode without re-rendering/re-translating: only switch CSS classes.
      applyDisplayMode(!currentSplitViewEnabled);
    });
    document.body.appendChild(button);
  }

  // Keep the button visible in both modes and update label accordingly.
  button.textContent = currentSplitViewEnabled ? '切换到单栏译文' : '切换到双栏对照';
}

function formatDuration(durationMs) {
  if (!durationMs) {
    return '-';
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function renderDebugOverlay() {
  const existingOverlay = document.getElementById('translate-extension-debug');
  if (!currentDebugEnabled) {
    if (existingOverlay) {
      existingOverlay.remove();
    }
    return;
  }

  let overlay = existingOverlay;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'translate-extension-debug';
    document.body.appendChild(overlay);
  }

  if (!currentDebugState) {
    overlay.textContent = '调试信息初始化中...';
    return;
  }

  const lines = [
    '调试信息',
    `状态: ${currentDebugState.status}`,
    `视图: ${currentDebugState.splitViewEnabled ? '双栏对照' : '单栏译文'}`,
    `文本节点: ${currentDebugState.textNodeCount}`,
    `批次数: ${currentDebugState.batchCount}`,
    `完成批次: ${currentDebugState.completedBatches} / ${currentDebugState.totalBatches}`,
    `批处理模式: ${currentDebugState.batchMode}`,
    `耗时: ${formatDuration(currentDebugState.durationMs)}`
  ];

  if (currentDebugState.errorMessage) {
    lines.push(`错误: ${currentDebugState.errorMessage}`);
  }

  overlay.textContent = lines.join('\n');
}

function updateDebugState(patch) {
  if (!currentDebugEnabled || !currentDebugState) {
    return;
  }

  currentDebugState = {
    ...currentDebugState,
    ...patch
  };
  renderDebugOverlay();
}

function isInsideExtensionUi(node) {
  let current = node && node.parentNode;
  while (current) {
    if (current.id && current.id.startsWith('translate-extension-')) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function extractTextNodes(element) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        if (isInsideExtensionUi(node)) {
          return NodeFilter.FILTER_REJECT;
        }
        const parentName = node.parentNode.nodeName;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT'].includes(parentName)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.nodeValue.trim() === '') {
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while(node = walker.nextNode()) {
    textNodes.push(node);
  }
  return textNodes;
}

function buildEstimateTextMap(textNodes) {
  const textMap = {};
  textNodes.forEach((node, index) => {
    textMap[index] = node.nodeValue.trim();
  });
  return textMap;
}

function collectEstimatePayload() {
  const root = document.body || document.documentElement;
  const textNodes = extractTextNodes(root);
  return {
    pageTitle: document.title || '',
    pageUrl: window.location.href,
    textNodeCount: textNodes.length,
    textMap: buildEstimateTextMap(textNodes)
  };
}

function isScrollableElement(el) {
  if (!el) {
    return false;
  }

  const style = el.ownerDocument && el.ownerDocument.defaultView
    ? el.ownerDocument.defaultView.getComputedStyle(el)
    : null;

  const overflowY = style ? style.overflowY : '';
  const scrollableOverflow = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
  const hasScroll = (el.scrollHeight - el.clientHeight) > 32;

  // Some root elements scroll even when overflowY isn't explicitly scroll/auto.
  return hasScroll && (scrollableOverflow || el === el.ownerDocument.documentElement || el === el.ownerDocument.body);
}

function getVisibleAreaScore(win, el) {
  const rect = el.getBoundingClientRect();
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const iw = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
  const ih = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
  return iw * ih;
}

function findPrimaryScrollTarget(win) {
  const doc = win.document;
  const scrollingElement = doc.scrollingElement || doc.documentElement;

  // Fast path: regular window scrolling.
  if (isScrollableElement(scrollingElement)) {
    return {
      kind: 'window',
      win,
      eventTarget: win,
      scrollElement: scrollingElement
    };
  }

  // Many sites scroll inside a main container (overflow: auto/scroll). Find it from viewport center.
  let el = null;
  try {
    el = doc.elementFromPoint(win.innerWidth / 2, win.innerHeight / 2);
  } catch (_) {
    el = null;
  }

  let best = null;
  let bestScore = 0;
  while (el && el instanceof win.HTMLElement) {
    if (isScrollableElement(el)) {
      const score = getVisibleAreaScore(win, el);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    el = el.parentElement;
  }

  if (best) {
    return {
      kind: 'element',
      win,
      eventTarget: best,
      scrollElement: best
    };
  }

  // Fallback to window anyway.
  return {
    kind: 'window',
    win,
    eventTarget: win,
    scrollElement: scrollingElement
  };
}

function getMaxScrollTop(target) {
  const el = target.scrollElement;
  return Math.max(0, el.scrollHeight - el.clientHeight);
}

function getScrollTop(target) {
  return target.scrollElement.scrollTop || 0;
}

function setScrollTop(target, top) {
  const max = getMaxScrollTop(target);
  const clamped = Math.max(0, Math.min(top, max));

  if (target.kind === 'window') {
    target.win.scrollTo(0, clamped);
    return;
  }

  target.scrollElement.scrollTop = clamped;
}

function setupScrollSync(mainWindow, iframeWindow) {
  const leftTarget = findPrimaryScrollTarget(mainWindow);
  const rightTarget = findPrimaryScrollTarget(iframeWindow);

  let isSyncingLeft = false;
  let isSyncingRight = false;

  // Listen for scroll events on the left side (original page)
  leftTarget.eventTarget.addEventListener('scroll', () => {
    if (!currentSplitViewEnabled) {
      return;
    }
    if (!isSyncingLeft) {
      isSyncingRight = true; // Prevent infinite loop by locking the other side
      
      // Calculate scroll percentage
      const maxLeft = getMaxScrollTop(leftTarget);
      const scrollPercentage = maxLeft > 0 ? getScrollTop(leftTarget) / maxLeft : 0;
      
      // Apply percentage to iframe
      const maxRight = getMaxScrollTop(rightTarget);
      setScrollTop(rightTarget, scrollPercentage * maxRight);

      // Release lock shortly after
      setTimeout(() => { isSyncingRight = false; }, 50);
    }
  }, { passive: true });

  // Listen for scroll events on the right side (translated iframe)
  rightTarget.eventTarget.addEventListener('scroll', () => {
    if (!currentSplitViewEnabled) {
      return;
    }
    if (!isSyncingRight) {
      isSyncingLeft = true; // Prevent infinite loop by locking the other side
      
      // Calculate scroll percentage
      const maxRight = getMaxScrollTop(rightTarget);
      const scrollPercentage = maxRight > 0 ? getScrollTop(rightTarget) / maxRight : 0;
      
      // Apply percentage to main window
      const maxLeft = getMaxScrollTop(leftTarget);
      setScrollTop(leftTarget, scrollPercentage * maxLeft);

      // Release lock shortly after
      setTimeout(() => { isSyncingLeft = false; }, 50);
    }
  }, { passive: true });
}

async function requestBatchTranslation(textMap) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'translate_text',
      payload: textMap
    }, (res) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      if (res.error) {
        return reject(new Error(res.error));
      }
      resolve(res.translatedMap);
    });
  });
}

function applyBatchResponse(batch, response) {
  batch.forEach((item) => {
    if (!response || !response[item.localIndex]) {
      return;
    }

    const originalText = item.node.nodeValue;
    const trimmed = originalText.trim();
    item.node.nodeValue = originalText.replace(trimmed, response[item.localIndex]);
  });
}

function updateBatchProgress(loadingElement, completed, total, modeLabel) {
  if (!loadingElement) {
    return;
  }

  loadingElement.textContent = `已完成 ${completed} / ${total} 批${modeLabel}`;
}

async function runBatchesWithConcurrency(batchRecords, workerCount, loadingElement, onProgress) {
  let completed = 0;
  let nextBatchIndex = 0;
  const total = batchRecords.length;
  const activeWorkerCount = Math.min(workerCount, total);
  const mode = '并发';

  updateBatchProgress(loadingElement, completed, total, '，并发处理中...');
  if (onProgress) {
    onProgress({ completed, total, mode });
  }

  async function worker() {
    while (nextBatchIndex < total) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      const batch = batchRecords[batchIndex];
      const textMap = {};

      batch.forEach((item) => {
        textMap[item.localIndex] = item.node.nodeValue.trim();
      });

      const response = await requestBatchTranslation(textMap);
      applyBatchResponse(batch, response);

      completed += 1;
      updateBatchProgress(loadingElement, completed, total, '，并发处理中...');
      if (onProgress) {
        onProgress({ completed, total, mode });
      }
    }
  }

  const workers = Array.from({ length: activeWorkerCount }, () => worker());
  await Promise.all(workers);
}

async function runBatchesSequentially(batchRecords, loadingElement, onProgress) {
  const total = batchRecords.length;
  const mode = '串行';

  if (onProgress) {
    onProgress({ completed: 0, total, mode });
  }

  for (let index = 0; index < total; index += 1) {
    const batch = batchRecords[index];
    updateBatchProgress(loadingElement, index, total, '，串行处理中...');

    const textMap = {};
    batch.forEach((item) => {
      textMap[item.localIndex] = item.node.nodeValue.trim();
    });

    const response = await requestBatchTranslation(textMap);
    applyBatchResponse(batch, response);

    updateBatchProgress(loadingElement, index + 1, total, '，串行处理中...');
    if (onProgress) {
      onProgress({ completed: index + 1, total, mode });
    }
  }
}

async function translateInBatches(textNodes, loadingElement, options) {
  const batchSize = 30; // Number of text nodes per batch
  const batchRecords = [];
  
  for (let i = 0; i < textNodes.length; i += batchSize) {
    const rawBatch = textNodes.slice(i, i + batchSize);
    batchRecords.push(rawBatch.map((node, index) => ({
      node,
      localIndex: index
    })));
  }

  updateDebugState({
    status: '开始批量翻译',
    batchCount: batchRecords.length,
    totalBatches: batchRecords.length,
    completedBatches: 0,
    batchMode: options.enableBatchConcurrency ? '并发' : '串行'
  });

  if (options.enableBatchConcurrency) {
    await runBatchesWithConcurrency(batchRecords, BATCH_CONCURRENCY_LIMIT, loadingElement, options.onProgress);
    return;
  }

  await runBatchesSequentially(batchRecords, loadingElement, options.onProgress);
}
