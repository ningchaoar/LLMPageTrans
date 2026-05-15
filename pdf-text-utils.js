(function(global) {
  const DEFAULT_LINE_GAP_THRESHOLD = 5;
  const DEFAULT_PARAGRAPH_GAP_THRESHOLD = 18;
  const DEFAULT_WORD_GAP_THRESHOLD = 3;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getItemX(item) {
    return item && item.transform && Number.isFinite(item.transform[4]) ? item.transform[4] : 0;
  }

  function getItemY(item) {
    return item && item.transform && Number.isFinite(item.transform[5]) ? item.transform[5] : 0;
  }

  function getItemWidth(item) {
    return item && Number.isFinite(item.width) ? item.width : 0;
  }

  function toTextItems(items) {
    return (items || [])
      .map((item) => ({
        text: normalizeText(item && item.str),
        x: getItemX(item),
        y: getItemY(item),
        width: getItemWidth(item)
      }))
      .filter((item) => item.text);
  }

  function appendText(lineText, item, previousItem, wordGapThreshold) {
    if (!lineText) {
      return item.text;
    }

    const gap = previousItem ? item.x - (previousItem.x + previousItem.width) : 0;
    const needsSpace = gap > wordGapThreshold
      && !/\s$/.test(lineText)
      && !/^[,.;:!?)]/.test(item.text);

    return `${lineText}${needsSpace ? ' ' : ''}${item.text}`;
  }

  function buildLines(items, options) {
    const lineGapThreshold = options.lineGapThreshold || DEFAULT_LINE_GAP_THRESHOLD;
    const wordGapThreshold = options.wordGapThreshold || DEFAULT_WORD_GAP_THRESHOLD;
    const lines = [];

    items.forEach((item) => {
      const currentLine = lines[lines.length - 1];

      if (!currentLine || Math.abs(currentLine.y - item.y) > lineGapThreshold) {
        lines.push({
          y: item.y,
          text: item.text,
          lastItem: item
        });
        return;
      }

      currentLine.text = appendText(currentLine.text, item, currentLine.lastItem, wordGapThreshold);
      currentLine.lastItem = item;
      currentLine.y = (currentLine.y + item.y) / 2;
    });

    return lines.map((line) => ({
      y: line.y,
      text: normalizeText(line.text)
    })).filter((line) => line.text);
  }

  function createBlock(pageNumber, blockIndex, text) {
    return {
      id: `page_${pageNumber}_block_${blockIndex}`,
      pageNumber,
      blockIndex,
      text: normalizeText(text)
    };
  }

  function groupPdfTextItems(items, options) {
    const opts = options || {};
    const pageNumber = opts.pageNumber || 1;
    const paragraphGapThreshold = opts.paragraphGapThreshold || DEFAULT_PARAGRAPH_GAP_THRESHOLD;
    const lines = buildLines(toTextItems(items), opts);
    const blocks = [];
    let currentLines = [];
    let previousLine = null;

    function flushBlock() {
      const text = normalizeText(currentLines.map((line) => line.text).join(' '));
      if (text) {
        blocks.push(createBlock(pageNumber, blocks.length, text));
      }
      currentLines = [];
    }

    lines.forEach((line) => {
      if (previousLine && Math.abs(previousLine.y - line.y) > paragraphGapThreshold) {
        flushBlock();
      }

      currentLines.push(line);
      previousLine = line;
    });

    flushBlock();
    return blocks;
  }

  function buildPdfTextMap(pages) {
    const textMap = {};

    (pages || []).forEach((page) => {
      (page.blocks || []).forEach((block) => {
        const text = normalizeText(block.text);
        if (block.id && text) {
          textMap[block.id] = text;
        }
      });
    });

    return textMap;
  }

  function countPdfTextCharacters(pages) {
    return Object.values(buildPdfTextMap(pages))
      .reduce((total, text) => total + text.length, 0);
  }

  const api = {
    buildPdfTextMap,
    countPdfTextCharacters,
    groupPdfTextItems
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  global.PdfTextUtils = api;
})(globalThis);
