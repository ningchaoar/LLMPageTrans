# PDF Mask Overlay Design

## Goal

Improve PDF translation layout fidelity by reusing the rendered original PDF page as the translated-page backdrop, covering source text regions, and placing translated text in the same page coordinates.

## Approach

The current PDF Layout mode already extracts text blocks with page-space bounding boxes. This design keeps that data model and adds presentation metadata that lets the viewer render a translated facsimile page:

- Render the original PDF page image in both the source column and translated column.
- For every extracted text block, draw a light mask rectangle over the original text area on the translated page.
- Place the translation over the mask using the block bbox, source font size, and simple fit metadata.
- Keep Readable mode as the fallback for pages where the layout reconstruction is not useful.

## Components

- `pdf-text-utils.js` owns layout metadata derived from PDF text items: bboxes, mask bboxes, and fit hints.
- `pdf-viewer.js` owns DOM rendering: source page image, translated facsimile background, mask layers, and translated text layers.
- `pdf-viewer.css` owns the facsimile styling, text fit behavior, and print-like visual treatment.
- `tests/pdf-text-utils.test.js` covers deterministic geometry behavior without needing a browser.

## Behavior

Layout mode should make the right-hand page look like a translated copy of the original page. Non-text content such as figures, formulas, table borders, and page decorations remain visible because they come from the original rendered page image. Text regions are covered before translated text is drawn, reducing visual clashes with the source language.

Text fitting is conservative. The viewer should reduce font size for long translations, clamp line height, and hide overflowing text inside the original bbox rather than expanding blocks until they overlap unrelated content.

## Limits

This is still a PDF visual reconstruction, not a true PDF editor. It will not perfectly preserve documents with missing text layers, heavily rotated text, overlapping annotations, complex transparency, or translations that are much longer than the original box. Those cases should be handled later by OCR/layout-model routes or source-file routes such as arXiv LaTeX.
