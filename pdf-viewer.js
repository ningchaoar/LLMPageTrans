import * as pdfjsLib from './vendor/pdfjs/pdf.mjs';

const TEXTLESS_PDF_THRESHOLD = 24;
const PAGE_TRANSLATION_DELAY_MS = 0;

const sourceLabel = document.getElementById('sourceLabel');
const statusPanel = document.getElementById('statusPanel');
const statusText = document.getElementById('statusText');
const progressText = document.getElementById('progressText');
const estimatePanel = document.getElementById('estimatePanel');
const emptyPanel = document.getElementById('emptyPanel');
const pagesContainer = document.getElementById('pages');
const layoutModeBtn = document.getElementById('layoutModeBtn');
const readableModeBtn = document.getElementById('readableModeBtn');
const estimateBtn = document.getElementById('estimateBtn');
const translateBtn = document.getElementById('translateBtn');

const {
  buildPdfLayoutBlocks,
  buildPdfTextMap,
  countPdfTextCharacters,
  groupPdfTextItems
} = globalThis.PdfTextUtils;

let sourceUrl = '';
let documentTitle = '';
let pdfPages = [];
let isTranslating = false;
let displayMode = 'layout';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.mjs');

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(value || 0);
}

function formatMoney(value) {
  if (value === null || value === undefined) {
    return '未配置';
  }
  return `~ ${Number(value).toFixed(4)}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(message, detail, isError) {
  statusText.textContent = message || '';
  progressText.textContent = detail || '';
  statusPanel.classList.toggle('error', isError === true);
}

function setBusyState(isBusy) {
  estimateBtn.disabled = isBusy || pdfPages.length === 0 || isTextlessPdf();
  translateBtn.disabled = isBusy || pdfPages.length === 0 || isTextlessPdf();
}

function parseQuery() {
  const params = new URLSearchParams(window.location.search);
  sourceUrl = params.get('source') || '';
  documentTitle = params.get('title') || '';
}

function isTextlessPdf() {
  return countPdfTextCharacters(pdfPages) < TEXTLESS_PDF_THRESHOLD;
}

function getBlockTranslationElement(blockId) {
  return document.querySelector(`[data-translation-id="${CSS.escape(blockId)}"]`);
}

function getLayoutTranslationElement(blockId) {
  return document.querySelector(`[data-layout-translation-id="${CSS.escape(blockId)}"]`);
}

function calculateOverlayFontSize(block, text) {
  const baseFontSize = Math.max(6, Math.min(14, block.fitFontSize || block.fontSize || 10));
  const sourceLength = Math.max(1, String(block.text || '').length);
  const targetLength = Math.max(1, String(text || '').length);

  if (targetLength <= sourceLength * 1.15) {
    return baseFontSize;
  }

  return Math.max(6, Math.round(baseFontSize * Math.sqrt((sourceLength * 1.15) / targetLength) * 10) / 10);
}

function renderEstimate(estimate) {
  estimatePanel.hidden = false;
  estimatePanel.innerHTML = `
    <div class="estimate-grid">
      <div class="estimate-item"><strong>页面</strong>${escapeHtml(estimate.pageTitle || documentTitle || 'PDF')}</div>
      <div class="estimate-item"><strong>文本节点</strong>${formatNumber(estimate.textNodeCount)}</div>
      <div class="estimate-item"><strong>输入 Tokens</strong>${formatNumber(estimate.estimatedInputTokens)}</div>
      <div class="estimate-item"><strong>输出 Tokens</strong>${formatNumber(estimate.estimatedOutputTokens)}</div>
      <div class="estimate-item"><strong>总 Tokens</strong>${formatNumber(estimate.estimatedTotalTokens)}</div>
      <div class="estimate-item"><strong>页面批次</strong>${formatNumber(estimate.estimatedPageBatchCount)}</div>
      <div class="estimate-item"><strong>大 Prompt 分片</strong>${formatNumber(estimate.chunkCount)}</div>
      <div class="estimate-item"><strong>预估成本</strong>${formatMoney(estimate.estimatedCost)}</div>
      <div class="estimate-item"><strong>模型</strong>${escapeHtml(estimate.modelName)}</div>
    </div>
    ${estimate.warningMessage ? `<div class="estimate-warning">${escapeHtml(estimate.warningMessage)}</div>` : ''}
  `;
}

function renderTextlessMessage() {
  emptyPanel.hidden = false;
  emptyPanel.textContent = '这个 PDF 没有提取到足够的文本层内容，可能是扫描版或图片型 PDF。当前 MVP 先支持可复制文本的 PDF。';
}

function renderReadablePage(page) {
  const section = document.createElement('section');
  section.className = 'page readable-page';
  section.dataset.pageNumber = String(page.pageNumber);

  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <span>Page ${page.pageNumber}</span>
    <span class="page-status" data-page-status="${page.pageNumber}">${page.blocks.length} blocks</span>
  `;
  section.appendChild(header);

  if (page.blocks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'page-empty';
    empty.textContent = 'No extractable text found on this page.';
    section.appendChild(empty);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'block-grid';

  page.blocks.forEach((block) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'block';

    const source = document.createElement('div');
    source.className = 'source-block';
    source.textContent = block.text;

    const translated = document.createElement('div');
    translated.className = 'translated-block pending';
    translated.dataset.translationId = block.id;
    translated.textContent = page.translations && page.translations[block.id]
      ? page.translations[block.id]
      : 'Waiting for translation';
    if (page.translations && page.translations[block.id]) {
      translated.classList.remove('pending');
    }

    wrapper.appendChild(source);
    wrapper.appendChild(translated);
    grid.appendChild(wrapper);
  });

  section.appendChild(grid);
  return section;
}

function createLayoutBlockElement(block, page) {
  const element = document.createElement('div');
  element.className = `layout-translation-block ${block.type || 'paragraph'}`;
  element.dataset.layoutTranslationId = block.id;
  element.style.left = `${block.bbox.x}px`;
  element.style.top = `${block.bbox.y}px`;
  element.style.width = `${Math.max(24, block.bbox.width)}px`;
  element.style.height = `${Math.max(12, block.bbox.height)}px`;
  const text = page.translations && page.translations[block.id]
    ? page.translations[block.id]
    : block.text;
  element.style.fontSize = `${calculateOverlayFontSize(block, text)}px`;
  element.textContent = text;
  element.title = text;
  if (page.translations && page.translations[block.id]) {
    element.classList.add('translated');
  }
  return element;
}

function createLayoutMaskElement(block) {
  const mask = document.createElement('div');
  mask.className = `layout-text-mask ${block.type || 'paragraph'}`;
  const bbox = block.maskBbox || block.bbox;
  mask.style.left = `${bbox.x}px`;
  mask.style.top = `${bbox.y}px`;
  mask.style.width = `${Math.max(1, bbox.width)}px`;
  mask.style.height = `${Math.max(1, bbox.height)}px`;
  return mask;
}

function appendPageBackground(container, page, label) {
  if (!page.sourceImageDataUrl) {
    return;
  }

  const image = document.createElement('img');
  image.className = 'pdf-page-background';
  image.src = page.sourceImageDataUrl;
  image.alt = label;
  image.width = page.viewport.width;
  image.height = page.viewport.height;
  container.appendChild(image);
}

function renderLayoutPage(page) {
  const section = document.createElement('section');
  section.className = 'page layout-page-pair';
  section.dataset.pageNumber = String(page.pageNumber);

  const header = document.createElement('div');
  header.className = 'page-header layout-pair-header';
  header.innerHTML = `
    <span>Page ${page.pageNumber}</span>
    <span class="page-status" data-page-status="${page.pageNumber}">${page.blocks.length} layout blocks</span>
  `;

  const body = document.createElement('div');
  body.className = 'layout-pair-body';

  const sourceShell = document.createElement('div');
  sourceShell.className = 'pdf-page-shell';
  const sourceTitle = document.createElement('div');
  sourceTitle.className = 'layout-column-title';
  sourceTitle.textContent = 'Original';
  const sourcePage = document.createElement('div');
  sourcePage.className = 'pdf-canvas-page';
  sourcePage.style.width = `${page.viewport.width}px`;
  sourcePage.style.height = `${page.viewport.height}px`;
  appendPageBackground(sourcePage, page, `Original PDF page ${page.pageNumber}`);
  sourceShell.appendChild(sourceTitle);
  sourceShell.appendChild(sourcePage);

  const translatedShell = document.createElement('div');
  translatedShell.className = 'pdf-page-shell';
  const translatedTitle = document.createElement('div');
  translatedTitle.className = 'layout-column-title';
  translatedTitle.textContent = 'Translated Layout';
  const translatedPage = document.createElement('div');
  translatedPage.className = 'translated-layout-page';
  translatedPage.style.width = `${page.viewport.width}px`;
  translatedPage.style.height = `${page.viewport.height}px`;

  appendPageBackground(translatedPage, page, `Translated PDF page background ${page.pageNumber}`);

  page.blocks.forEach((block) => {
    translatedPage.appendChild(createLayoutMaskElement(block));
  });

  page.blocks.forEach((block) => {
    translatedPage.appendChild(createLayoutBlockElement(block, page));
  });

  translatedShell.appendChild(translatedTitle);
  translatedShell.appendChild(translatedPage);

  body.appendChild(sourceShell);
  body.appendChild(translatedShell);
  section.appendChild(header);
  section.appendChild(body);
  return section;
}

function renderPages() {
  pagesContainer.innerHTML = '';
  pagesContainer.classList.toggle('layout-mode', displayMode === 'layout');
  pagesContainer.classList.toggle('readable-mode', displayMode === 'readable');

  pdfPages.forEach((page) => {
    pagesContainer.appendChild(displayMode === 'layout'
      ? renderLayoutPage(page)
      : renderReadablePage(page));
  });
}

function setPageStatus(pageNumber, message) {
  const element = document.querySelector(`[data-page-status="${pageNumber}"]`);
  if (element) {
    element.textContent = message;
  }
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

function buildEstimatePayload() {
  const textMap = buildPdfTextMap(pdfPages);
  return {
    pageTitle: documentTitle || 'PDF',
    pageUrl: sourceUrl,
    textNodeCount: Object.keys(textMap).length,
    textMap
  };
}

function buildSessionId() {
  return `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildPageTextMap(page) {
  const textMap = {};
  page.blocks.forEach((block) => {
    textMap[block.id] = block.text;
  });
  return textMap;
}

async function estimatePdf() {
  if (isTextlessPdf()) {
    renderTextlessMessage();
    return null;
  }

  setBusyState(true);
  setStatus('Estimating PDF translation cost...', '', false);

  try {
    const response = await sendRuntimeMessage({
      action: 'estimate_translation_cost',
      payload: buildEstimatePayload()
    });

    if (!response || response.error) {
      throw new Error(response && response.error ? response.error : '预估失败');
    }

    renderEstimate(response.estimate);
    setStatus('Estimate ready', `${response.estimate.textNodeCount} text blocks`, false);
    return response.estimate;
  } finally {
    setBusyState(false);
  }
}

async function requestPageTranslation(page, sessionId, totalPages) {
  const textMap = buildPageTextMap(page);
  const response = await sendRuntimeMessage({
    action: 'translate_text',
    payload: {
      textMap,
      meta: {
        sessionId,
        batchIndex: page.pageNumber - 1,
        totalBatches: totalPages,
        pageTitle: documentTitle || 'PDF',
        pageUrl: sourceUrl
      }
    }
  });

  if (!response || response.error) {
    throw new Error(response && response.error ? response.error : '翻译失败');
  }

  return response.translatedMap || {};
}

function applyPageTranslation(page, translatedMap) {
  page.translations = {
    ...(page.translations || {}),
    ...translatedMap
  };

  page.blocks.forEach((block) => {
    const element = getBlockTranslationElement(block.id);
    if (element) {
      element.classList.remove('pending');
      element.textContent = translatedMap[block.id] || block.text;
    }

    const layoutElement = getLayoutTranslationElement(block.id);
    if (layoutElement) {
      const translatedText = translatedMap[block.id] || block.text;
      layoutElement.classList.add('translated');
      layoutElement.textContent = translatedText;
      layoutElement.title = translatedText;
      layoutElement.style.fontSize = `${calculateOverlayFontSize(block, translatedText)}px`;
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function finalizeBrutalLog(sessionId, status, startedAt, errorMessage) {
  await sendRuntimeMessage({
    action: 'finalize_brutal_test_log',
    payload: {
      sessionId,
      status,
      durationMs: Date.now() - startedAt,
      textNodeCount: Object.keys(buildPdfTextMap(pdfPages)).length,
      batchCount: pdfPages.length,
      errorMessage: errorMessage || ''
    }
  });
}

async function translatePdf() {
  if (isTranslating || isTextlessPdf()) {
    return;
  }

  isTranslating = true;
  setBusyState(true);
  const sessionId = buildSessionId();
  const startedAt = Date.now();

  try {
    setStatus('Translating PDF...', `0 / ${pdfPages.length} pages`, false);

    for (let index = 0; index < pdfPages.length; index += 1) {
      const page = pdfPages[index];
      if (page.blocks.length === 0) {
        setPageStatus(page.pageNumber, 'No text');
        continue;
      }

      setPageStatus(page.pageNumber, 'Translating...');
      const translatedMap = await requestPageTranslation(page, sessionId, pdfPages.length);
      applyPageTranslation(page, translatedMap);
      setPageStatus(page.pageNumber, 'Translated');
      setStatus('Translating PDF...', `${index + 1} / ${pdfPages.length} pages`, false);
      await delay(PAGE_TRANSLATION_DELAY_MS);
    }

    await finalizeBrutalLog(sessionId, 'completed', startedAt);
    setStatus('PDF translation completed', `${pdfPages.length} pages processed`, false);
  } catch (error) {
    await finalizeBrutalLog(sessionId, 'failed', startedAt, error.message);
    setStatus('PDF translation failed', error.message, true);
  } finally {
    isTranslating = false;
    setBusyState(false);
  }
}

async function renderPageToDataUrl(page, viewport) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  await page.render({
    canvasContext: context,
    viewport
  }).promise;

  return canvas.toDataURL('image/png');
}

async function extractPdfPages(pdfDocument) {
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    setStatus('Extracting PDF text...', `${pageNumber} / ${pdfDocument.numPages} pages`, false);
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.2 });
    const sourceImageDataUrl = await renderPageToDataUrl(page, viewport);
    const textContent = await page.getTextContent();
    const blocks = buildPdfLayoutBlocks(textContent.items, {
      pageNumber,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      viewportTransform: viewport.transform
    });
    const readableBlocks = groupPdfTextItems(textContent.items, { pageNumber });
    pages.push({
      pageNumber,
      blocks,
      readableBlocks,
      viewport: {
        width: Math.ceil(viewport.width),
        height: Math.ceil(viewport.height)
      },
      sourceImageDataUrl,
      translations: {}
    });
  }

  return pages;
}

async function fetchPdfData(url) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`PDF request failed with ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

async function loadPdf() {
  parseQuery();

  if (!sourceUrl) {
    setStatus('Missing PDF source URL', 'Open this page from the extension popup on a PDF tab.', true);
    setBusyState(true);
    return;
  }

  sourceLabel.textContent = documentTitle ? `${documentTitle} - ${sourceUrl}` : sourceUrl;
  setBusyState(true);
  setStatus('Loading PDF...', sourceUrl, false);

  try {
    const data = await fetchPdfData(sourceUrl);
    const loadingTask = pdfjsLib.getDocument({
      data,
      isEvalSupported: false
    });
    const pdfDocument = await loadingTask.promise;
    documentTitle = documentTitle || `PDF (${pdfDocument.numPages} pages)`;
    pdfPages = await extractPdfPages(pdfDocument);
    renderPages();

    const characterCount = countPdfTextCharacters(pdfPages);
    if (characterCount < TEXTLESS_PDF_THRESHOLD) {
      renderTextlessMessage();
      setStatus('No usable text layer found', `${characterCount} extracted characters`, true);
      setBusyState(false);
      return;
    }

    setStatus('PDF text extracted', `${pdfDocument.numPages} pages, ${characterCount} characters`, false);
  } catch (error) {
    setStatus('Failed to load PDF', error.message, true);
  } finally {
    setBusyState(false);
  }
}

estimateBtn.addEventListener('click', () => {
  estimatePdf().catch((error) => {
    setStatus('Estimate failed', error.message, true);
    setBusyState(false);
  });
});

translateBtn.addEventListener('click', () => {
  translatePdf().catch((error) => {
    setStatus('Translation failed', error.message, true);
    isTranslating = false;
    setBusyState(false);
  });
});

function setDisplayMode(nextMode) {
  displayMode = nextMode;
  layoutModeBtn.classList.toggle('active', displayMode === 'layout');
  readableModeBtn.classList.toggle('active', displayMode === 'readable');
  renderPages();
}

layoutModeBtn.addEventListener('click', () => {
  setDisplayMode('layout');
});

readableModeBtn.addEventListener('click', () => {
  setDisplayMode('readable');
});

loadPdf();
