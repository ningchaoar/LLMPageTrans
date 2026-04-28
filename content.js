let isTranslating = false;
let currentIframe = null;
let scrollSyncBound = false;
let currentSplitViewEnabled = true;
const BATCH_CONCURRENCY_LIMIT = 6;
document.documentElement.setAttribute('data-translate-extension-ready', 'true');

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'start_translation') {
    if (!isTranslating) {
      startTranslation(request.options || {});
    }
  }
});

async function startTranslation(options) {
  isTranslating = true;
  const splitViewEnabled = options.splitViewEnabled !== false;
  const enableBatchConcurrency = options.enableBatchConcurrency !== false;
  currentSplitViewEnabled = splitViewEnabled;
  cleanupExistingTranslation();

  // Create loading indicator
  const loading = document.createElement('div');
  loading.id = 'translate-extension-loading';
  loading.textContent = '准备翻译...';
  document.body.appendChild(loading);

  // 2. Clone page into iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'translate-extension-iframe';
  currentIframe = iframe;
  
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
    
    if (textNodes.length === 0) {
      loading.textContent = '未找到可翻译文本';
      setTimeout(() => loading.remove(), 2000);
      isTranslating = false;
      return;
    }

    // 4. Send to background script for translation in batches
    try {
      await translateInBatches(textNodes, loading, {
        enableBatchConcurrency
      });
      loading.textContent = '翻译完成';
      loading.style.background = '#4caf50';
      setTimeout(() => loading.remove(), 3000);
      isTranslating = false;
    } catch (err) {
      console.error('Translation error:', err);
      loading.textContent = 'Error: ' + err.message;
      loading.style.background = '#f44336';
      isTranslating = false;
    }
  };
}

function cleanupExistingTranslation() {
  document.documentElement.classList.remove('llm-translator-split');
  currentIframe = null;
  currentSplitViewEnabled = true;
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
}

function applyDisplayMode(splitViewEnabled) {
  currentSplitViewEnabled = splitViewEnabled;
  document.documentElement.classList.toggle('llm-translator-split', splitViewEnabled);

  if (currentIframe) {
    currentIframe.classList.toggle('translate-extension-fullscreen', !splitViewEnabled);
  }

  if (splitViewEnabled && currentIframe && currentIframe.contentWindow && !scrollSyncBound) {
    setupScrollSync(window, currentIframe.contentWindow);
    scrollSyncBound = true;
  }

  updateViewToggleButton();
}

function updateViewToggleButton() {
  let button = document.getElementById('translate-extension-toggle-view');

  if (currentSplitViewEnabled || !currentIframe) {
    if (button) {
      button.remove();
    }
    return;
  }

  if (!button) {
    button = document.createElement('button');
    button.id = 'translate-extension-toggle-view';
    button.textContent = '切换到双栏对照';
    button.addEventListener('click', () => {
      applyDisplayMode(true);
    });
    document.body.appendChild(button);
  }
}

function extractTextNodes(element) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
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

function setupScrollSync(mainWindow, iframeWindow) {
  let isSyncingLeft = false;
  let isSyncingRight = false;

  // Listen for scroll events on the main window (Left Side)
  mainWindow.addEventListener('scroll', () => {
    if (!isSyncingLeft) {
      isSyncingRight = true; // Prevent infinite loop by locking the other side
      
      // Calculate scroll percentage
      const mainScrollHeight = mainWindow.document.documentElement.scrollHeight - mainWindow.innerHeight;
      const scrollPercentage = mainScrollHeight > 0 ? mainWindow.scrollY / mainScrollHeight : 0;
      
      // Apply percentage to iframe
      const iframeScrollHeight = iframeWindow.document.documentElement.scrollHeight - iframeWindow.innerHeight;
      iframeWindow.scrollTo(0, scrollPercentage * iframeScrollHeight);

      // Release lock shortly after
      setTimeout(() => { isSyncingRight = false; }, 50);
    }
  }, { passive: true });

  // Listen for scroll events on the iframe (Right Side)
  iframeWindow.addEventListener('scroll', () => {
    if (!isSyncingRight) {
      isSyncingLeft = true; // Prevent infinite loop by locking the other side
      
      // Calculate scroll percentage
      const iframeScrollHeight = iframeWindow.document.documentElement.scrollHeight - iframeWindow.innerHeight;
      const scrollPercentage = iframeScrollHeight > 0 ? iframeWindow.scrollY / iframeScrollHeight : 0;
      
      // Apply percentage to main window
      const mainScrollHeight = mainWindow.document.documentElement.scrollHeight - mainWindow.innerHeight;
      mainWindow.scrollTo(0, scrollPercentage * mainScrollHeight);

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

async function runBatchesWithConcurrency(batchRecords, workerCount, loadingElement) {
  let completed = 0;
  let nextBatchIndex = 0;
  const total = batchRecords.length;
  const activeWorkerCount = Math.min(workerCount, total);

  updateBatchProgress(loadingElement, completed, total, '，并发处理中...');

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
    }
  }

  const workers = Array.from({ length: activeWorkerCount }, () => worker());
  await Promise.all(workers);
}

async function runBatchesSequentially(batchRecords, loadingElement) {
  const total = batchRecords.length;

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

  if (options.enableBatchConcurrency) {
    await runBatchesWithConcurrency(batchRecords, BATCH_CONCURRENCY_LIMIT, loadingElement);
    return;
  }

  await runBatchesSequentially(batchRecords, loadingElement);
}
