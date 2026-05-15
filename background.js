importScripts('provider-config.js', 'endpoint-storage.js', 'providers.js');

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'translate_text') {
    handleTranslation(request.payload)
      .then(translatedMap => {
        sendResponse({ translatedMap });
      })
      .catch(error => {
        console.error('Translation error in background:', error);
        sendResponse({ error: error.message });
      });
    return true; // Keep message channel open for async response
  }

  if (request.action === 'estimate_translation_cost') {
    handleEstimateRequest(request.payload)
      .then(estimate => {
        sendResponse({ estimate });
      })
      .catch(error => {
        console.error('Estimate error in background:', error);
        sendResponse({ error: error.message });
      });
    return true;
  }

  if (request.action === 'finalize_brutal_test_log') {
    finalizeBrutalTestLog(request.payload)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        console.error('Finalize brutal test log error in background:', error);
        sendResponse({ error: error.message });
      });
    return true;
  }
});

const DEFAULT_TARGET_LANGUAGE = '专业而地道的中文';
const DEFAULT_GLOSSARY = `# 无需翻译\n- token\n\n# 特定翻译\n- Agent: 智能体`;
const MAX_PROMPT_WORDS = 4096;
const DEFAULT_ESTIMATED_OUTPUT_RATIO = 1.2;
const ESTIMATION_MESSAGE_OVERHEAD_TOKENS = 60;
const ESTIMATION_WARNING_THRESHOLD = 120000;
const PAGE_BATCH_SIZE = 30;
const BRUTAL_TEST_LOG_DIR = 'LLMPageTrans/brutal-test-logs';
const brutalTestLogSessions = new Map();

function buildBrutalTestString(text) {
  const source = String(text || '');
  const length = source.length;

  if (length === 0) {
    return '';
  }

  if (length === 1) {
    return '#';
  }

  return `#${'*'.repeat(Math.max(0, length - 2))}#`;
}

function buildBrutalTestTranslation(textMap) {
  const translatedMap = {};

  Object.entries(textMap || {}).forEach(([id, value]) => {
    translatedMap[id] = buildBrutalTestString(value);
  });

  return translatedMap;
}

function normalizeTranslationPayload(payload) {
  if (payload && payload.textMap) {
    return {
      textMap: payload.textMap,
      meta: payload.meta || {}
    };
  }

  return {
    textMap: payload || {},
    meta: {}
  };
}

function sanitizeFilenamePart(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'untitled';
}

function getBrutalLogSession(sessionId, meta, settings) {
  const key = sessionId || `anonymous_${Date.now()}`;

  if (!brutalTestLogSessions.has(key)) {
    brutalTestLogSessions.set(key, {
      sessionId: key,
      createdAt: new Date().toISOString(),
      pageTitle: meta.pageTitle || '',
      pageUrl: meta.pageUrl || '',
      endpointName: settings.endpoint.name,
      providerId: settings.providerId,
      providerLabel: settings.providerDefinition.label,
      modelName: settings.modelName,
      targetLang: settings.targetLang,
      enablePromptChunking: settings.enablePromptChunking,
      calls: []
    });
  }

  return brutalTestLogSessions.get(key);
}

function buildBrutalTestLogCalls(textMap, settings, meta) {
  const systemPrompt = buildSystemPrompt(settings.targetLang, settings.glossaryMarkdown);
  const userPrompt = JSON.stringify(textMap);
  const shouldChunk = settings.enablePromptChunking === true && countWords(userPrompt) > MAX_PROMPT_WORDS;

  if (!shouldChunk) {
    return [{
      batchIndex: meta.batchIndex,
      totalBatches: meta.totalBatches,
      chunkIndex: 0,
      totalChunks: 1,
      systemPrompt,
      userPrompt
    }];
  }

  const { chunks } = buildTranslationChunks(textMap, MAX_PROMPT_WORDS);
  return chunks.map((chunk, chunkIndex) => ({
    batchIndex: meta.batchIndex,
    totalBatches: meta.totalBatches,
    chunkIndex,
    totalChunks: chunks.length,
    systemPrompt,
    userPrompt: JSON.stringify(chunk)
  }));
}

function tryParseJsonContent(content) {
  try {
    return {
      ok: true,
      value: JSON.parse(content)
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message
    };
  }
}

async function runBrutalTestCallsForLog(textMap, settings, meta, runtimeProviderConfig) {
  const session = getBrutalLogSession(meta.sessionId, meta, settings);
  const calls = buildBrutalTestLogCalls(textMap, settings, meta);

  for (const call of calls) {
    const callRecord = {
      callIndex: session.calls.length,
      recordedAt: new Date().toISOString(),
      ...call,
      outputRaw: '',
      outputParsed: null,
      outputParseError: '',
      errorMessage: ''
    };

    session.calls.push(callRecord);

    try {
      const outputRaw = await globalThis.sendProviderChatCompletion(
        settings.providerId,
        runtimeProviderConfig,
        {
          model: settings.modelName,
          systemPrompt: call.systemPrompt,
          userPrompt: call.userPrompt
        }
      );
      const parsed = tryParseJsonContent(outputRaw);
      callRecord.outputRaw = outputRaw;
      callRecord.completedAt = new Date().toISOString();

      if (parsed.ok) {
        callRecord.outputParsed = parsed.value;
      } else {
        callRecord.outputParseError = parsed.errorMessage;
      }
    } catch (error) {
      callRecord.errorMessage = error.message;
      callRecord.completedAt = new Date().toISOString();
      throw error;
    }
  }
}

async function runBrutalTestTranslation(textMap, settings, meta, runtimeProviderConfig) {
  await runBrutalTestCallsForLog(textMap, settings, meta, runtimeProviderConfig);
  return buildBrutalTestTranslation(textMap);
}

function downloadTextFile(filename, text) {
  return new Promise((resolve, reject) => {
    const url = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
    chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(downloadId);
    });
  });
}

async function finalizeBrutalTestLog(payload) {
  const meta = payload || {};
  const sessionId = meta.sessionId;

  if (!sessionId || !brutalTestLogSessions.has(sessionId)) {
    return { skipped: true };
  }

  const session = brutalTestLogSessions.get(sessionId);
  brutalTestLogSessions.delete(sessionId);

  const completedAt = new Date().toISOString();
  const log = {
    ...session,
    completedAt,
    status: meta.status || 'completed',
    durationMs: meta.durationMs || 0,
    textNodeCount: meta.textNodeCount || 0,
    batchCount: meta.batchCount || 0,
    errorMessage: meta.errorMessage || '',
    callCount: session.calls.length
  };

  const pagePart = sanitizeFilenamePart(session.pageTitle || 'page');
  const timePart = completedAt.replace(/[:.]/g, '-');
  const filename = `${BRUTAL_TEST_LOG_DIR}/${timePart}-${pagePart}.json`;
  const downloadId = await downloadTextFile(filename, JSON.stringify(log, null, 2));

  return {
    saved: true,
    filename,
    downloadId
  };
}

function toNumber(value, fallbackValue) {
  if (value === '' || value === null || value === undefined) {
    return fallbackValue;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function roundUp(value) {
  return Math.max(0, Math.ceil(value));
}

function countWords(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function estimateTokens(text) {
  const normalized = String(text || '');
  if (!normalized.trim()) {
    return 0;
  }

  const cjkMatches = normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || [];
  const cjkCount = cjkMatches.length;
  const totalChars = normalized.length;
  const nonCjkChars = Math.max(0, totalChars - cjkCount);
  const wordCount = countWords(normalized);

  return roundUp(cjkCount * 1.15 + nonCjkChars / 4 + wordCount * 0.2);
}

function findSplitIndex(text, maxWords) {
  if (countWords(text) <= maxWords) {
    return text.length;
  }

  const wordRegex = /\S+/g;
  let candidateEnd = text.length;
  let wordCount = 0;
  while (wordRegex.exec(text) !== null) {
    wordCount += 1;
    if (wordCount === maxWords) {
      candidateEnd = wordRegex.lastIndex;
      break;
    }
  }

  const searchArea = text.slice(0, candidateEnd);
  const newlineIndex = searchArea.lastIndexOf('\n');
  if (newlineIndex > 0) {
    return newlineIndex + 1;
  }

  const periodIndex = searchArea.lastIndexOf('.');
  if (periodIndex > 0) {
    return periodIndex + 1;
  }

  for (let i = searchArea.length - 1; i >= 0; i -= 1) {
    if (/\s/.test(searchArea[i])) {
      return i + 1;
    }
  }

  return candidateEnd;
}

function splitTextByWordLimit(text, maxWords) {
  const normalizedText = String(text || '');
  if (!normalizedText.trim()) {
    return [''];
  }

  const segments = [];
  let remaining = normalizedText;

  while (countWords(remaining) > maxWords) {
    const splitIndex = findSplitIndex(remaining, maxWords);
    const segment = remaining.slice(0, splitIndex).trim();

    if (!segment) {
      break;
    }

    segments.push(segment);
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining.trim()) {
    segments.push(remaining.trim());
  }

  return segments.length ? segments : [normalizedText];
}

function buildTranslationChunks(textMap, maxWords) {
  const fragmentMetadata = {};
  const fragments = [];

  Object.entries(textMap).forEach(([id, value]) => {
    const segments = splitTextByWordLimit(value, maxWords);
    segments.forEach((segment, index) => {
      const fragmentId = segments.length === 1 ? id : `${id}__part_${index}`;
      fragmentMetadata[fragmentId] = {
        originalId: id,
        order: index
      };
      fragments.push({
        id: fragmentId,
        text: segment
      });
    });
  });

  const chunks = [];
  let currentChunk = {};
  let currentWords = 0;

  fragments.forEach((fragment) => {
    const fragmentWords = Math.max(1, countWords(fragment.text));
    const nextWordCount = currentWords + fragmentWords;

    if (nextWordCount > maxWords && Object.keys(currentChunk).length > 0) {
      chunks.push(currentChunk);
      currentChunk = {};
      currentWords = 0;
    }

    currentChunk[fragment.id] = fragment.text;
    currentWords += fragmentWords;
  });

  if (Object.keys(currentChunk).length > 0) {
    chunks.push(currentChunk);
  }

  return { chunks, fragmentMetadata };
}

function buildSystemPrompt(targetLanguage, currentGlossary) {
  return `You are an expert translator specializing in Computer Science, Large Language Models, scientific papers, and professional tech blogs.
You will receive a JSON object mapping IDs to text snippets. Translate all text snippets to ${targetLanguage}.

Translation Guidelines:
1. Maintain a professional, academic, and highly accurate tone appropriate for technical domains.
2. Preserve widely recognized English technical terminology where appropriate, or use industry-standard translations.
3. CRITICAL: Do NOT translate mathematical formulas, variables, code snippets, or operators (e.g., x, y, +, -, =, i++, log, exp, softmax, dropout). Leave them exactly as they appear.
4. Keep the translation contextually appropriate for a webpage layout.

Here is the user-defined Glossary:
<glossary>
${currentGlossary}
</glossary>

Follow these glossary rules strictly:
- For items under "# 无需翻译" (Do Not Translate), keep the original English word exactly as is.
- For items under "# 特定翻译" (Specific Translations), use the specified translation and append the original English word in parentheses. For example, if the rule is "Agent: 智能体", translate it as "智能体(Agent)".

Return ONLY a valid JSON object where the keys are the exact same IDs, and the values are the translated text snippets.
Do not wrap the JSON in Markdown formatting (like \`\`\`json). Return raw JSON.`;
}

function buildEstimationWarning({
  textNodeCount,
  estimatedTotalTokens,
  chunkCount,
  estimatedCost,
  brutalTestModeEnabled
}) {
  if (textNodeCount === 0) {
    return '当前页面未提取到可翻译文本。';
  }

  if (brutalTestModeEnabled === true) {
    return '当前开启暴力测试模式，会真实调用模型并写入日志，但页面只显示等长占位字符串。';
  }

  if (estimatedTotalTokens >= ESTIMATION_WARNING_THRESHOLD) {
    return '本次页面规模较大，建议先确认成本，再考虑开启分批或切换更低成本模型。';
  }

  if (chunkCount > 1) {
    return `预计会拆成 ${chunkCount} 个大 Prompt 分片，翻译耗时可能明显增加。`;
  }

  if (estimatedCost !== null && estimatedCost >= 1) {
    return '本次预估成本较高，建议先确认模型价格配置是否正确。';
  }

  return '页面规模处于可接受范围，可直接尝试翻译。';
}

function buildEstimationResult(textMap, options) {
  const {
    pageTitle,
    pageUrl,
    textNodeCount,
    providerId,
    providerLabel,
    endpointName,
    modelName,
    targetLang,
    glossaryMarkdown,
    enablePromptChunking,
    brutalTestModeEnabled,
    inputPricePerMillion,
    outputPricePerMillion,
    estimatedOutputRatio
  } = options;

  const systemPrompt = buildSystemPrompt(targetLang, glossaryMarkdown);
  const systemPromptTokens = estimateTokens(systemPrompt);
  const userPrompt = JSON.stringify(textMap);
  const sourceText = Object.values(textMap).join('\n');
  const sourceTextTokens = estimateTokens(sourceText);
  const userPromptTokens = estimateTokens(userPrompt);
  const hasTranslatableText = textNodeCount > 0 && Object.keys(textMap).length > 0;
  const shouldChunk = enablePromptChunking === true && countWords(userPrompt) > MAX_PROMPT_WORDS;
  const chunkInfo = shouldChunk ? buildTranslationChunks(textMap, MAX_PROMPT_WORDS) : { chunks: [textMap] };
  const chunkCount = hasTranslatableText ? chunkInfo.chunks.length : 0;
  const maxChunkWords = hasTranslatableText
    ? chunkInfo.chunks.reduce((maxWords, chunk) => {
      return Math.max(maxWords, countWords(JSON.stringify(chunk)));
    }, 0)
    : 0;

  const estimatedInputTokens = hasTranslatableText
    ? roundUp(systemPromptTokens * chunkCount + userPromptTokens + ESTIMATION_MESSAGE_OVERHEAD_TOKENS * chunkCount)
    : 0;
  const outputRatio = Math.max(0.5, toNumber(estimatedOutputRatio, DEFAULT_ESTIMATED_OUTPUT_RATIO));
  const estimatedOutputTokens = hasTranslatableText
    ? roundUp(Math.max(32, sourceTextTokens * outputRatio))
    : 0;
  const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;

  const hasPriceConfig = Number.isFinite(inputPricePerMillion) && inputPricePerMillion >= 0
    && Number.isFinite(outputPricePerMillion) && outputPricePerMillion >= 0;
  const estimatedCost = hasPriceConfig
    ? (estimatedInputTokens / 1000000) * inputPricePerMillion + (estimatedOutputTokens / 1000000) * outputPricePerMillion
    : null;

  return {
    pageTitle,
    pageUrl,
    providerId,
    providerLabel,
    endpointName,
    modelName,
    targetLang,
    brutalTestModeEnabled,
    textNodeCount,
    textCharacterCount: sourceText.length,
    promptWordCount: countWords(userPrompt),
    sourceTextTokens,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens,
    chunkCount,
    estimatedPageBatchCount: Math.max(1, Math.ceil(textNodeCount / PAGE_BATCH_SIZE)),
    maxChunkWords,
    shouldChunk,
    inputPricePerMillion: hasPriceConfig ? inputPricePerMillion : null,
    outputPricePerMillion: hasPriceConfig ? outputPricePerMillion : null,
    estimatedCost,
    warningMessage: buildEstimationWarning({
      textNodeCount,
      estimatedTotalTokens,
      chunkCount,
      estimatedCost,
      brutalTestModeEnabled
    })
  };
}

function mergeTranslatedChunks(originalMap, translatedMaps, fragmentMetadata) {
  const grouped = {};

  translatedMaps.forEach((translatedMap) => {
    Object.entries(translatedMap).forEach(([fragmentId, translatedText]) => {
      const metadata = fragmentMetadata[fragmentId];
      if (!metadata) {
        grouped[fragmentId] = [{ order: 0, text: translatedText }];
        return;
      }

      if (!grouped[metadata.originalId]) {
        grouped[metadata.originalId] = [];
      }

      grouped[metadata.originalId].push({
        order: metadata.order,
        text: translatedText
      });
    });
  });

  const mergedMap = {};
  Object.keys(originalMap).forEach((id) => {
    if (!grouped[id]) {
      mergedMap[id] = originalMap[id];
      return;
    }

    mergedMap[id] = grouped[id]
      .sort((a, b) => a.order - b.order)
      .map((item) => item.text)
      .join(' ');
  });

  return mergedMap;
}

function parseJsonResponse(content) {
  let normalizedContent = content;

  if (normalizedContent.startsWith('```json')) {
    normalizedContent = normalizedContent.replace(/^```json/, '').replace(/```$/, '').trim();
  } else if (normalizedContent.startsWith('```')) {
    normalizedContent = normalizedContent.replace(/^```/, '').replace(/```$/, '').trim();
  }

  try {
    return JSON.parse(normalizedContent);
  } catch (error) {
    console.error('Failed to parse LLM response:', normalizedContent);
    throw new Error('LLM did not return valid JSON');
  }
}

async function translateTextMap(providerId, providerConfig, model, systemPrompt, textMap) {
  const userPrompt = JSON.stringify(textMap);
  const content = await globalThis.sendProviderChatCompletion(providerId, providerConfig, {
    model,
    systemPrompt,
    userPrompt
  });
  return parseJsonResponse(content);
}

function getStoredSettings(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, resolve);
  });
}

function getLocalSettings(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

async function getRuntimeEndpointSettings() {
  const [syncItems, localItems] = await Promise.all([
    getStoredSettings([
      'selectedProvider',
      'providers',
      'apiUrl',
      'apiKey',
      'modelName',
      'targetLang',
      'glossaryMarkdown',
      'enablePromptChunking',
      'inputPricePerMillion',
      'outputPricePerMillion',
      'estimatedOutputRatio',
      'enableBrutalTestMode'
    ]),
    getLocalSettings([globalThis.ENDPOINTS_STORAGE_KEY])
  ]);

  const endpointState = localItems[globalThis.ENDPOINTS_STORAGE_KEY]
    ? globalThis.normalizeEndpointsState(localItems[globalThis.ENDPOINTS_STORAGE_KEY])
    : globalThis.buildLegacyEndpointsState(syncItems);
  const endpoint = globalThis.findEndpointById(endpointState, endpointState.currentEndpointId);

  if (!endpoint) {
    throw new Error('当前没有可用的模型接入点，请先在 Manage Endpoints 中创建。');
  }

  const providerDefinition = globalThis.getProviderDefinition(endpoint.mode);

  return {
    endpoint,
    providerId: endpoint.mode,
    providerDefinition,
    modelName: endpoint.modelName || providerDefinition.defaultConfig.modelName,
    targetLang: endpoint.targetLang || DEFAULT_TARGET_LANGUAGE,
    glossaryMarkdown: syncItems.glossaryMarkdown || DEFAULT_GLOSSARY,
    enablePromptChunking: syncItems.enablePromptChunking === true,
    estimatedOutputRatio: toNumber(syncItems.estimatedOutputRatio, DEFAULT_ESTIMATED_OUTPUT_RATIO),
    brutalTestModeEnabled: syncItems.enableBrutalTestMode === true
  };
}

async function handleEstimateRequest(payload) {
  const textMap = payload && payload.textMap ? payload.textMap : {};
  const textNodeCount = payload && payload.textNodeCount ? payload.textNodeCount : Object.keys(textMap).length;
  const settings = await getRuntimeEndpointSettings();

  return buildEstimationResult(textMap, {
    pageTitle: payload.pageTitle || '',
    pageUrl: payload.pageUrl || '',
    textNodeCount,
    providerId: settings.providerId,
    providerLabel: settings.providerDefinition.label,
    endpointName: settings.endpoint.name,
    modelName: settings.modelName,
    targetLang: settings.targetLang,
    glossaryMarkdown: settings.glossaryMarkdown,
    enablePromptChunking: settings.enablePromptChunking,
    brutalTestModeEnabled: settings.brutalTestModeEnabled,
    inputPricePerMillion: toNumber(settings.endpoint.inputPricePerMillion, NaN),
    outputPricePerMillion: toNumber(settings.endpoint.outputPricePerMillion, NaN),
    estimatedOutputRatio: settings.estimatedOutputRatio
  });
}

async function handleTranslation(payload) {
  return new Promise((resolve, reject) => {
    getRuntimeEndpointSettings().then(async (settings) => {
      const { textMap, meta } = normalizeTranslationPayload(payload);

      if (!settings.endpoint.apiKey) {
        return reject(new Error(`API Key is not configured for endpoint "${settings.endpoint.name}". Please open Manage Endpoints and complete it.`));
      }

      if (!settings.endpoint.baseUrl) {
        return reject(new Error(`API URL is not configured for endpoint "${settings.endpoint.name}". Please open Manage Endpoints and complete it.`));
      }

      const systemPrompt = buildSystemPrompt(settings.targetLang, settings.glossaryMarkdown);
      const runtimeProviderConfig = {
        baseUrl: settings.endpoint.baseUrl,
        apiKey: settings.endpoint.apiKey
      };

      try {
        if (settings.brutalTestModeEnabled === true) {
          const translatedMap = await runBrutalTestTranslation(
            textMap,
            settings,
            meta,
            runtimeProviderConfig
          );
          resolve(translatedMap);
          return;
        }

        const userPrompt = JSON.stringify(textMap);
        const shouldChunk = settings.enablePromptChunking === true && countWords(userPrompt) > MAX_PROMPT_WORDS;

        if (!shouldChunk) {
          const translatedMap = await translateTextMap(
            settings.providerId,
            runtimeProviderConfig,
            settings.modelName,
            systemPrompt,
            textMap
          );
          resolve(translatedMap);
          return;
        }

        const { chunks, fragmentMetadata } = buildTranslationChunks(textMap, MAX_PROMPT_WORDS);
        const translatedMaps = [];

        for (const chunk of chunks) {
          const translatedChunk = await translateTextMap(
            settings.providerId,
            runtimeProviderConfig,
            settings.modelName,
            systemPrompt,
            chunk
          );
          translatedMaps.push(translatedChunk);
        }

        resolve(mergeTranslatedChunks(textMap, translatedMaps, fragmentMetadata));
      } catch (err) {
        reject(err);
      }
    }).catch(reject);
  });
}
