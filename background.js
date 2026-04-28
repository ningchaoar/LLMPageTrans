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
});

const DEFAULT_API_URL = 'https://aidp.bytedance.net/api/modelhub/online/v2/crawl';
const DEFAULT_MODEL = 'gpt-5.4-2026-03-05';
const DEFAULT_TARGET_LANGUAGE = '专业而地道的中文';
const DEFAULT_GLOSSARY = `# 无需翻译\n- token\n\n# 特定翻译\n- Agent: 智能体`;
const MAX_PROMPT_WORDS = 4096;

function countWords(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
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

async function translateTextMap(url, model, systemPrompt, textMap) {
  const userPrompt = JSON.stringify(textMap);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      stream: false,
      model,
      max_tokens: 4096,
      reasoning: { effort: 'none' },
      messages: [
        {
          role: 'system',
          content: [
            {
              type: 'text',
              text: systemPrompt
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userPrompt
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API Error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  let content = data.choices[0].message.content;

  if (content.startsWith('```json')) {
    content = content.replace(/^```json/, '').replace(/```$/, '').trim();
  } else if (content.startsWith('```')) {
    content = content.replace(/^```/, '').replace(/```$/, '').trim();
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to parse LLM response:', content);
    throw new Error('LLM did not return valid JSON');
  }
}

async function handleTranslation(textMap) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get([
      'apiUrl',
      'apiKey',
      'modelName',
      'targetLang',
      'glossaryMarkdown',
      'enablePromptChunking'
    ], async (items) => {
      const {
        apiUrl,
        apiKey,
        modelName,
        targetLang,
        glossaryMarkdown,
        enablePromptChunking
      } = items;

      if (!apiKey) {
        return reject(new Error('API Key is not configured. Please open the extension popup and configure it.'));
      }

      const urlBase = apiUrl || DEFAULT_API_URL;
      const model = modelName || DEFAULT_MODEL;
      const lang = targetLang || DEFAULT_TARGET_LANGUAGE;
      
      let url = urlBase;
      if (!url.includes('ak=')) {
        const separator = url.includes('?') ? '&' : '?';
        url = `${url}${separator}ak=${apiKey}`;
      }

      const currentGlossary = glossaryMarkdown || DEFAULT_GLOSSARY;

      const systemPrompt = `You are an expert translator specializing in Computer Science, Large Language Models, scientific papers, and professional tech blogs.
You will receive a JSON object mapping IDs to text snippets. Translate all text snippets to ${lang}.

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

      try {
        const userPrompt = JSON.stringify(textMap);
        const shouldChunk = enablePromptChunking === true && countWords(userPrompt) > MAX_PROMPT_WORDS;

        if (!shouldChunk) {
          const translatedMap = await translateTextMap(url, model, systemPrompt, textMap);
          resolve(translatedMap);
          return;
        }

        const { chunks, fragmentMetadata } = buildTranslationChunks(textMap, MAX_PROMPT_WORDS);
        const translatedMaps = [];

        for (const chunk of chunks) {
          const translatedChunk = await translateTextMap(url, model, systemPrompt, chunk);
          translatedMaps.push(translatedChunk);
        }

        resolve(mergeTranslatedChunks(textMap, translatedMaps, fragmentMetadata));
      } catch (err) {
        reject(err);
      }
    });
  });
}
