const {
  buildPdfLayoutBlocks,
  buildPdfTextMap,
  countPdfTextCharacters,
  groupPdfTextItems
} = require('../pdf-text-utils.js');

function textItem(str, x, y, width) {
  return {
    str,
    width: width === undefined ? str.length * 5 : width,
    transform: [1, 0, 0, 1, x, y]
  };
}

test('groupPdfTextItems merges adjacent items on the same line', () => {
  const blocks = groupPdfTextItems([
    textItem('Large', 10, 700, 25),
    textItem('language', 40, 700, 42),
    textItem('models', 88, 700, 30)
  ], { pageNumber: 2 });

  assertDeepEqual(blocks, [{
    id: 'page_2_block_0',
    pageNumber: 2,
    blockIndex: 0,
    text: 'Large language models'
  }]);
});

test('groupPdfTextItems starts a new block when vertical gap is large', () => {
  const blocks = groupPdfTextItems([
    textItem('First paragraph.', 10, 700, 80),
    textItem('Still first paragraph.', 10, 686, 100),
    textItem('Second paragraph.', 10, 650, 90)
  ], { pageNumber: 1, lineGapThreshold: 8, paragraphGapThreshold: 22 });

  assertDeepEqual(blocks, [
    {
      id: 'page_1_block_0',
      pageNumber: 1,
      blockIndex: 0,
      text: 'First paragraph. Still first paragraph.'
    },
    {
      id: 'page_1_block_1',
      pageNumber: 1,
      blockIndex: 1,
      text: 'Second paragraph.'
    }
  ]);
});

test('groupPdfTextItems ignores empty text and preserves stable block ids', () => {
  const blocks = groupPdfTextItems([
    textItem('', 10, 700, 0),
    textItem('  ', 10, 700, 0),
    textItem('Abstract', 10, 700, 45)
  ], { pageNumber: 3 });

  assertDeepEqual(blocks, [{
    id: 'page_3_block_0',
    pageNumber: 3,
    blockIndex: 0,
    text: 'Abstract'
  }]);
});

test('buildPdfTextMap flattens pages into translation ids', () => {
  const textMap = buildPdfTextMap([
    {
      pageNumber: 1,
      blocks: [
        { id: 'page_1_block_0', text: 'Intro' },
        { id: 'page_1_block_1', text: 'Method' }
      ]
    },
    {
      pageNumber: 2,
      blocks: [
        { id: 'page_2_block_0', text: 'Results' }
      ]
    }
  ]);

  assertDeepEqual(textMap, {
    page_1_block_0: 'Intro',
    page_1_block_1: 'Method',
    page_2_block_0: 'Results'
  });
});

test('countPdfTextCharacters sums extracted block text', () => {
  const count = countPdfTextCharacters([
    {
      pageNumber: 1,
      blocks: [
        { id: 'page_1_block_0', text: 'abc' },
        { id: 'page_1_block_1', text: 'de' }
      ]
    },
    {
      pageNumber: 2,
      blocks: [
        { id: 'page_2_block_0', text: 'fghi' }
      ]
    }
  ]);

  assertEqual(count, 9);
});

test('buildPdfLayoutBlocks preserves text geometry in block bounding boxes', () => {
  const blocks = buildPdfLayoutBlocks([
    textItem('Abstract', 72, 700, 48),
    textItem('This', 72, 680, 24),
    textItem('paper', 102, 680, 32),
    textItem('introduces', 140, 680, 60)
  ], {
    pageNumber: 4,
    viewportWidth: 612,
    viewportHeight: 792,
    lineGapThreshold: 6,
    paragraphGapThreshold: 12
  });

  assertEqual(blocks.length, 2);
  assertDeepEqual(blocks[0].bbox, {
    x: 72,
    y: 700,
    width: 48,
    height: 10
  });
  assertDeepEqual(blocks[1].bbox, {
    x: 72,
    y: 680,
    width: 128,
    height: 10
  });
  assertEqual(blocks[1].text, 'This paper introduces');
});

test('buildPdfLayoutBlocks splits wide same-row gaps into table-like cells', () => {
  const blocks = buildPdfLayoutBlocks([
    textItem('Model', 72, 640, 42),
    textItem('Params', 230, 640, 50),
    textItem('Qwen3', 72, 620, 46),
    textItem('235B', 230, 620, 34)
  ], {
    pageNumber: 2,
    viewportWidth: 612,
    viewportHeight: 792,
    tableGapThreshold: 56
  });

  assertEqual(blocks.length, 4);
  assertDeepEqual(blocks.map((block) => block.type), ['tableCell', 'tableCell', 'tableCell', 'tableCell']);
  assertDeepEqual(blocks.map((block) => block.text), ['Model', 'Params', 'Qwen3', '235B']);
  assertDeepEqual(blocks[1].bbox, {
    x: 230,
    y: 640,
    width: 50,
    height: 10
  });
});

test('buildPdfLayoutBlocks converts PDF viewport transform to top-left coordinates', () => {
  const blocks = buildPdfLayoutBlocks([
    {
      str: 'Title',
      width: 40,
      transform: [10, 0, 0, 10, 72, 700]
    }
  ], {
    pageNumber: 1,
    viewportWidth: 612,
    viewportHeight: 792,
    viewportTransform: [1, 0, 0, -1, 0, 792]
  });

  assertDeepEqual(blocks[0].bbox, {
    x: 72,
    y: 82,
    width: 40,
    height: 10
  });
});

test('buildPdfLayoutBlocks adds padded mask boxes clamped to the viewport', () => {
  const blocks = buildPdfLayoutBlocks([
    {
      str: 'Edge',
      width: 18,
      height: 8,
      transform: [8, 0, 0, 8, 1, 3]
    }
  ], {
    pageNumber: 1,
    viewportWidth: 30,
    viewportHeight: 20,
    maskPadding: 4,
    lineGapThreshold: 6
  });

  assertDeepEqual(blocks[0].maskBbox, {
    x: 0,
    y: 0,
    width: 23,
    height: 15
  });
});

test('buildPdfLayoutBlocks reduces fit font size for dense text boxes', () => {
  const shortBlock = buildPdfLayoutBlocks([
    textItem('Short', 20, 120, 80)
  ], {
    pageNumber: 1
  })[0];
  const denseBlock = buildPdfLayoutBlocks([
    textItem('A very long translated sentence that needs tighter fitting', 20, 120, 80)
  ], {
    pageNumber: 1
  })[0];

  assertEqual(shortBlock.fitFontSize, shortBlock.fontSize);
  assertEqual(denseBlock.fitFontSize < denseBlock.fontSize, true);
  assertEqual(denseBlock.fitFontSize >= 6, true);
});
