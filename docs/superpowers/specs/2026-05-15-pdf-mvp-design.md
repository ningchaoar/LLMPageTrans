# PDF MVP Design

## Goal

Add a first usable PDF translation path for text-layer PDFs. The MVP should let a user open a PDF URL from the extension popup, extract page text, estimate and translate it through the existing provider pipeline, and read original text beside translated text in an extension page.

## Scope

The first version supports PDFs with an extractable text layer. It does not attempt OCR, screenshot-based multimodal translation, or pixel-perfect translated overlays. Scanned PDFs and pages with too little extracted text show a clear unsupported message.

## User Flow

1. The user opens a PDF URL or Chrome PDF viewer tab.
2. The user opens the extension popup and clicks the existing translate button.
3. If the active tab looks like a PDF, the popup opens `pdf-viewer.html` with the source PDF URL encoded in the query string.
4. The PDF viewer loads the PDF with local `pdf.js`, extracts text per page, and displays page cards with original text.
5. The user clicks estimate or translate in the PDF viewer.
6. The viewer reuses existing background actions:
   - `estimate_translation_cost`
   - `translate_text`
   - `finalize_brutal_test_log`
7. Translated text appears beside each original block.

## Architecture

The existing webpage translation flow stays intact. PDF work lives in a separate extension page and a small shared PDF text utility so the risky parsing and display logic does not tangle with `content.js`.

Files:

- `pdf-viewer.html`: extension page shell for the PDF translator.
- `pdf-viewer.css`: PDF reader layout and states.
- `pdf-text-utils.js`: pure helpers for grouping PDF text items into readable text blocks and building translation maps.
- `pdf-viewer.js`: PDF loading, page rendering, estimation, translation queue, and UI state.
- `vendor/pdfjs/`: local `pdf.js` assets, loaded by the extension page.
- `tests/pdf-text-utils.test.js`: Node-based tests for the pure helper logic.
- `tests/run-tests.js`: tiny local test runner because the project has no package manager setup.

## PDF Extraction

The viewer uses `pdfjsLib.getDocument({ url })`, then loads pages one by one. For each page it calls `page.getTextContent()` and passes `textContent.items` to `groupPdfTextItems`.

Grouping rules:

- Ignore empty text items.
- Preserve item order.
- Merge adjacent items on the same visual line with spaces when needed.
- Start a new line when vertical position changes.
- Start a new block when there is a large vertical gap.
- Return blocks as `{ id, pageNumber, blockIndex, text }`.

The MVP is deliberately heuristic. It aims for readable translation chunks rather than exact document layout reconstruction.

## Translation

The viewer sends one page at a time to `translate_text` with a `textMap` using stable block IDs. This avoids a huge all-document request and keeps progress visible. Existing prompt, glossary, provider adapters, prompt chunking, brutal test mode, and logging continue to work without a second translation stack.

If a page has no text blocks, the page is marked as unsupported or empty. If the whole PDF has too few text characters, the viewer explains that the PDF may be scanned.

## Estimation

The viewer builds a full-document `textMap` and sends it to `estimate_translation_cost`. The result is rendered in the PDF viewer using the same fields as popup estimates. This gives the user a cost signal before translation.

## Error Handling

- Missing or malformed `source` query: show a local error.
- PDF load failure: show a load error with the PDF URL.
- No extractable text: show a scanned-PDF limitation message.
- Translation failure on one page: keep previously translated pages and mark the failing page.
- User cancels or closes the page: no background work is persisted except any already downloaded brutal-test log.

## Testing

Automated MVP tests cover pure PDF text grouping and translation-map construction. Manual verification covers the browser-only parts:

- Load a text-layer PDF URL in `pdf-viewer.html`.
- Confirm page count and original text blocks render.
- Confirm estimate uses existing provider settings.
- Confirm brutal test mode logs calls and renders placeholder translations.
- Confirm scanned or textless PDFs show the limitation message.

## Acceptance Criteria

- From a PDF tab, the popup opens the PDF translation viewer.
- The viewer loads a text-layer PDF from URL and extracts page text.
- The viewer can estimate token/cost using existing settings.
- The viewer can translate extracted blocks page by page through the existing background flow.
- The viewer displays original and translated text side by side.
- Textless PDFs fail clearly instead of silently showing an empty translation.
- Existing normal webpage translation still passes syntax checks.
