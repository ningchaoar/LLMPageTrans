(function(global) {
  const DEFAULT_LINE_GAP_THRESHOLD = 5;
  const DEFAULT_PARAGRAPH_GAP_THRESHOLD = 18;
  const DEFAULT_WORD_GAP_THRESHOLD = 3;
  const DEFAULT_TABLE_GAP_THRESHOLD = 52;
  const DEFAULT_INDENT_THRESHOLD = 18;
  const DEFAULT_ITEM_HEIGHT = 10;
  const DEFAULT_MASK_PADDING = 2;
  const MIN_FIT_FONT_SIZE = 6;

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

  function roundPosition(value) {
    return Math.round(value * 100) / 100;
  }

  function multiplyTransforms(first, second) {
    return [
      first[0] * second[0] + first[2] * second[1],
      first[1] * second[0] + first[3] * second[1],
      first[0] * second[2] + first[2] * second[3],
      first[1] * second[2] + first[3] * second[3],
      first[0] * second[4] + first[2] * second[5] + first[4],
      first[1] * second[4] + first[3] * second[5] + first[5]
    ];
  }

  function getItemHeight(item, transform) {
    const transformHeight = transform
      ? Math.max(Math.abs(transform[3]), Math.abs(transform[2]))
      : 0;
    const itemHeight = item && Number.isFinite(item.height) ? item.height : 0;
    const measuredHeight = Math.max(transformHeight, itemHeight);
    return measuredHeight > 1 ? measuredHeight : DEFAULT_ITEM_HEIGHT;
  }

  function toLayoutFragment(item, options) {
    const text = normalizeText(item && item.str);
    if (!text) {
      return null;
    }

    const rawTransform = item && Array.isArray(item.transform)
      ? item.transform
      : [1, 0, 0, DEFAULT_ITEM_HEIGHT, getItemX(item), getItemY(item)];
    const transform = options.viewportTransform
      ? multiplyTransforms(options.viewportTransform, rawTransform)
      : rawTransform;
    const height = getItemHeight(item, transform);
    const x = transform[4];
    const y = options.viewportTransform ? transform[5] - height : transform[5];
    const viewportScaleX = options.viewportTransform
      ? Math.hypot(options.viewportTransform[0], options.viewportTransform[1]) || 1
      : 1;
    const width = getItemWidth(item) * viewportScaleX;

    return {
      text,
      x: roundPosition(x),
      y: roundPosition(y),
      width: roundPosition(width),
      height: roundPosition(height),
      fontSize: roundPosition(height)
    };
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

  function unionBbox(boxes) {
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));

    return {
      x: roundPosition(left),
      y: roundPosition(top),
      width: roundPosition(right - left),
      height: roundPosition(bottom - top)
    };
  }

  function clampBbox(bbox, options) {
    const viewportWidth = Number.isFinite(options.viewportWidth) ? options.viewportWidth : Infinity;
    const viewportHeight = Number.isFinite(options.viewportHeight) ? options.viewportHeight : Infinity;
    const left = Math.max(0, bbox.x);
    const top = Math.max(0, bbox.y);
    const right = Math.min(viewportWidth, bbox.x + bbox.width);
    const bottom = Math.min(viewportHeight, bbox.y + bbox.height);

    return {
      x: roundPosition(left),
      y: roundPosition(top),
      width: roundPosition(Math.max(0, right - left)),
      height: roundPosition(Math.max(0, bottom - top))
    };
  }

  function createMaskBbox(bbox, options) {
    const padding = Number.isFinite(options.maskPadding)
      ? options.maskPadding
      : DEFAULT_MASK_PADDING;

    return clampBbox({
      x: bbox.x - padding,
      y: bbox.y - padding,
      width: bbox.width + padding * 2,
      height: bbox.height + padding * 2
    }, options);
  }

  function estimateFitFontSize(text, bbox, fontSize) {
    const baseFontSize = Math.max(MIN_FIT_FONT_SIZE, fontSize || DEFAULT_ITEM_HEIGHT);
    const width = Math.max(1, bbox.width);
    const height = Math.max(1, bbox.height);
    const normalizedText = normalizeText(text);
    if (normalizedText.length * baseFontSize * 0.56 <= width) {
      return roundPosition(baseFontSize);
    }

    for (let candidate = baseFontSize; candidate >= MIN_FIT_FONT_SIZE; candidate -= 0.5) {
      const averageCharacterWidth = candidate * 0.56;
      const charactersPerLine = Math.max(1, Math.floor(width / averageCharacterWidth));
      const estimatedLines = Math.max(1, Math.ceil(normalizedText.length / charactersPerLine));
      const estimatedHeight = estimatedLines * candidate * 1.18;

      if (estimatedHeight <= height + 1) {
        return roundPosition(candidate);
      }
    }

    return MIN_FIT_FONT_SIZE;
  }

  function createLayoutBlock(pageNumber, blockIndex, type, fragments, options) {
    const bbox = unionBbox(fragments);
    const fontSize = fragments.reduce((sum, item) => sum + item.fontSize, 0) / fragments.length;
    const text = normalizeText(fragments.map((item) => item.text).join(' '));

    return {
      id: `page_${pageNumber}_block_${blockIndex}`,
      pageNumber,
      blockIndex,
      type,
      bbox,
      maskBbox: createMaskBbox(bbox, options || {}),
      fontSize: roundPosition(fontSize),
      fitFontSize: estimateFitFontSize(text, bbox, fontSize),
      text,
      lines: fragments.map((item) => ({
        text: item.text,
        bbox: {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height
        }
      }))
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

  function splitLineIntoRuns(line, tableGapThreshold) {
    const runs = [];
    let currentRun = [];
    let previous = null;

    line.fragments.forEach((fragment) => {
      const gap = previous ? fragment.x - (previous.x + previous.width) : 0;
      if (previous && gap > tableGapThreshold) {
        runs.push(currentRun);
        currentRun = [];
      }

      currentRun.push(fragment);
      previous = fragment;
    });

    if (currentRun.length > 0) {
      runs.push(currentRun);
    }

    return runs;
  }

  function buildLayoutLines(items, options) {
    const lineGapThreshold = options.lineGapThreshold || DEFAULT_LINE_GAP_THRESHOLD;
    const fragments = (items || [])
      .map((item) => toLayoutFragment(item, options))
      .filter(Boolean);
    const lines = [];

    fragments.forEach((fragment) => {
      const currentLine = lines[lines.length - 1];

      if (!currentLine || Math.abs(currentLine.y - fragment.y) > lineGapThreshold) {
        lines.push({
          y: fragment.y,
          fragments: [fragment]
        });
        return;
      }

      currentLine.fragments.push(fragment);
      currentLine.y = (currentLine.y + fragment.y) / 2;
    });

    return lines.map((line) => ({
      y: roundPosition(line.y),
      fragments: line.fragments.sort((a, b) => a.x - b.x)
    }));
  }

  function flattenLayoutRuns(lines, tableGapThreshold) {
    const runs = [];

    lines.forEach((line) => {
      const splitRuns = splitLineIntoRuns(line, tableGapThreshold);
      splitRuns.forEach((fragments) => {
        const bbox = unionBbox(fragments);
        runs.push({
          y: bbox.y,
          x: bbox.x,
          bbox,
          fragments,
          isTableLike: splitRuns.length > 1
        });
      });
    });

    return runs;
  }

  function shouldMergeLayoutRun(previousRun, nextRun, options) {
    if (!previousRun || !nextRun) {
      return false;
    }
    if (previousRun.isTableLike || nextRun.isTableLike) {
      return false;
    }

    const paragraphGapThreshold = options.paragraphGapThreshold || DEFAULT_PARAGRAPH_GAP_THRESHOLD;
    const indentThreshold = options.indentThreshold || DEFAULT_INDENT_THRESHOLD;
    const previousBottom = previousRun.bbox.y + previousRun.bbox.height;
    const verticalGap = nextRun.bbox.y - previousBottom;
    const xDelta = Math.abs(nextRun.bbox.x - previousRun.bbox.x);

    return verticalGap >= 0
      && verticalGap <= paragraphGapThreshold
      && xDelta <= indentThreshold;
  }

  function buildPdfLayoutBlocks(items, options) {
    const opts = options || {};
    const pageNumber = opts.pageNumber || 1;
    const tableGapThreshold = opts.tableGapThreshold || DEFAULT_TABLE_GAP_THRESHOLD;
    const lines = buildLayoutLines(items, opts);
    const runs = flattenLayoutRuns(lines, tableGapThreshold);
    const blocks = [];
    let currentRuns = [];

    function flushBlock(type) {
      if (currentRuns.length === 0) {
        return;
      }
      const fragments = currentRuns.flatMap((run) => run.fragments);
      blocks.push(createLayoutBlock(pageNumber, blocks.length, type || 'paragraph', fragments, opts));
      currentRuns = [];
    }

    runs.forEach((run) => {
      if (run.isTableLike) {
        flushBlock('paragraph');
        currentRuns = [run];
        flushBlock('tableCell');
        return;
      }

      const previousRun = currentRuns[currentRuns.length - 1];
      if (!shouldMergeLayoutRun(previousRun, run, opts)) {
        flushBlock('paragraph');
      }

      currentRuns.push(run);
    });

    flushBlock('paragraph');
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
    buildPdfLayoutBlocks,
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
