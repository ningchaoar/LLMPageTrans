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
const estimateBtn = document.getElementById('estimateBtn');
const translateBtn = document.getElementById('translateBtn');

const {
  buildPdfTextMap,
  countPdfTextCharacters,
  groupPdfTextItems
} = globalThis.PdfTextUtils;

let sourceUrl = '';
let documentTitle = '';
let pdfPages = [];
let isTranslating = false;

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

function renderPages() {
  pagesContainer.innerHTML = '';

  pdfPages.forEach((page) => {
    const section = document.createElement('section');
    section.className = 'page';
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
      pagesContainer.appendChild(section);
      return;
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
      translated.textContent = 'Waiting for translation';

      wrapper.appendChild(source);
      wrapper.appendChild(translated);
      grid.appendChild(wrapper);
    });

    section.appendChild(grid);
    pagesContainer.appendChild(section);
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
  page.blocks.forEach((block) => {
    const element = getBlockTranslationElement(block.id);
    if (!element) {
      return;
    }

    element.classList.remove('pending');
    element.textContent = translatedMap[block.id] || block.text;
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

async function extractPdfPages(pdfDocument) {
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    setStatus('Extracting PDF text...', `${pageNumber} / ${pdfDocument.numPages} pages`, false);
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const blocks = groupPdfTextItems(textContent.items, { pageNumber });
    pages.push({ pageNumber, blocks });
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

loadPdf();
