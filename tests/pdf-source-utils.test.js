const {
  extractPdfSourceFromTab,
  looksLikePdfUrl
} = require('../pdf-source-utils.js');

test('looksLikePdfUrl recognizes arXiv PDF routes without a .pdf suffix', () => {
  assertEqual(looksLikePdfUrl('https://arxiv.org/pdf/2505.09388'), true);
});

test('extractPdfSourceFromTab returns arXiv PDF route URLs', () => {
  const source = extractPdfSourceFromTab({
    url: 'https://arxiv.org/pdf/2505.09388',
    title: '2505.09388'
  });

  assertEqual(source, 'https://arxiv.org/pdf/2505.09388');
});

test('extractPdfSourceFromTab reads encoded PDF URLs from viewer query params', () => {
  const source = extractPdfSourceFromTab({
    url: 'https://example.com/viewer?file=https%3A%2F%2Fexample.com%2Fpaper.pdf',
    title: 'Viewer'
  });

  assertEqual(source, 'https://example.com/paper.pdf');
});

test('extractPdfSourceFromTab treats a fetchable URL with PDF title as a candidate', () => {
  const source = extractPdfSourceFromTab({
    url: 'https://example.com/download?id=abc',
    title: 'paper.pdf'
  });

  assertEqual(source, 'https://example.com/download?id=abc');
});

test('extractPdfSourceFromTab ignores regular web pages', () => {
  const source = extractPdfSourceFromTab({
    url: 'https://example.com/articles/pdf-tools',
    title: 'PDF tools article'
  });

  assertEqual(source, '');
});
