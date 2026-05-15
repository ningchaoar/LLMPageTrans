const {
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
