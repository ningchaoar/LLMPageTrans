# PDF Mask Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PDF Layout mode preserve non-text page content by rendering the original PDF page as the translated-page background, masking source text boxes, and drawing fitted translated text over those boxes.

**Architecture:** Keep PDF geometry extraction in `pdf-text-utils.js`; keep rendering in `pdf-viewer.js` and `pdf-viewer.css`. The extraction layer emits deterministic `maskBbox` and fit hints; the viewer renders background image, mask layer, and text layer per block.

**Tech Stack:** Chrome MV3 extension, pdf.js, vanilla JavaScript, CSS, existing Node-based unit test runner.

---

### Task 1: Layout Geometry Metadata

**Files:**
- Modify: `tests/pdf-text-utils.test.js`
- Modify: `pdf-text-utils.js`

- [ ] Add a failing test proving layout blocks include a padded `maskBbox` clamped to the page viewport.
- [ ] Add a failing test proving long text blocks emit a smaller `fitFontSize` than short text blocks with the same bbox.
- [ ] Implement `maskBbox` and `fitFontSize` in `buildPdfLayoutBlocks`.
- [ ] Run `node tests/run-tests.js` and confirm all tests pass.

### Task 2: Facsimile Rendering

**Files:**
- Modify: `pdf-viewer.js`
- Modify: `pdf-viewer.css`

- [ ] Render the original page image as the translated page background.
- [ ] Render one mask rectangle per block before the translated text.
- [ ] Render translated text inside a clipped bbox using `fitFontSize`.
- [ ] Keep Readable mode functional.

### Task 3: Documentation and Verification

**Files:**
- Modify: `README.md`

- [ ] Document the new Layout mode behavior and limits.
- [ ] Run `node tests/run-tests.js`.
- [ ] Run `node --check` for extension scripts and vendored PDF.js modules.
- [ ] Run `python3 -m json.tool manifest.json`.
- [ ] Run `git diff --check` and inspect `git status --short`.
