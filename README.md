# LLMPageTrans (Chrome Extension)

Translate the current webpage with an LLM and display the translated result with preserved layout.

This extension is designed for technical content (scientific papers, CS/LLM blogs) and supports:
- Split-screen comparison (original on the left, translated clone on the right)
- Or translated-only view (full-screen translated page)
- A Markdown glossary to control terms (do-not-translate + fixed translations with original kept in parentheses)
- Optional large-prompt chunking when the payload is too large
- Optional page-batch concurrency for faster translation

## Features

- **Layout-preserving translation**: the translated page is rendered in a right-side `iframe` cloned from the current page HTML, so DOM structure/CSS layout stays as close as possible.
- **Split-screen**: original page on the left, translated page on the right.
- **Translated-only view**: show only the translated clone; a floating button can switch back to split view without re-translating.
- **Scroll sync** (split mode): scrolling the translated side will attempt to sync the original side (percentage-based).
- **Glossary (Markdown)**:
  - `# 无需翻译`: terms that must stay exactly as-is.
  - `# 特定翻译`: fixed translations in the form `Term: 翻译` and the output should keep the original in parentheses, e.g. `智能体(Agent)`.
- **Professional prompt**: system prompt is tuned for CS/LLM/scientific writing, and avoids translating formulas/operators/code.

## How It Works

1. The content script injects an `iframe` (`srcdoc`) containing the current page HTML (`document.documentElement.outerHTML`).
2. The `iframe` is sandboxed without scripts to avoid client-side framework crashes (React/Next.js hydration issues).
3. The extension extracts text nodes from the `iframe` DOM (excluding script/style/etc), then sends them to the background service worker for LLM translation.
4. Translated strings are written back into the `iframe` text nodes, preserving layout.

## Install (Developer Mode)

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this directory:
   - `translate_webpage/`
4. Pin the extension (optional) for quick access.

## Usage

1. Open any webpage.
2. Click the extension icon.
3. Configure:
   - **API URL**: default `https://aidp.bytedance.net/api/modelhub/online/v2/crawl`
   - **API Key (ak)**: your `ak` value
   - **Model Name**: default `gpt-5.4-2026-03-05`
   - **Target Language**: default `专业而地道的中文`
4. Optional toggles:
   - **显示模式**: split-screen vs translated-only
   - **大文本分批**: chunk the payload when it exceeds 4096 words (default OFF)
   - **页面批次并发**: translate page batches concurrently (default ON, concurrency=6)
5. Click **Translate Current Page**.

## Glossary Editing

Click **Edit Glossary 词库配置** in the popup to open the glossary editor page.

Default glossary example:

```markdown
# 无需翻译
- token

# 特定翻译
- Agent: 智能体
```

## Notes / Limitations

- The translated clone runs **without scripts** inside the `iframe`. The layout is preserved, but interactive behaviors on the translated side may not work.
- Some pages load content dynamically. The clone reflects the DOM at the moment you trigger translation.
- Large pages can be slow and may hit model/API limits. Use:
  - **页面批次并发** for faster speed (but may increase rate-limit risk).
  - **大文本分批** for extra-large requests (kept serial on the backend to avoid inconsistent terminology).

## Troubleshooting

- **Click translate but nothing happens**
  - The popup dynamically injects `content.js`/`content.css` into tabs that were opened before the extension was installed/updated. If you still see issues, reload the extension in `chrome://extensions/` and refresh the page once.

- **Right-side page shows "Application error: a client-side exception..."**
  - This is usually caused by frameworks (Next.js/React) trying to hydrate inside the cloned page. The extension mitigates this by disabling scripts in the translated `iframe` via `sandbox`.

- **Rate limit / API errors**
  - Reduce concurrency by disabling **页面批次并发** (falls back to serial).
  - Check the background service worker console in `chrome://extensions/` -> this extension -> **Service worker** -> Console.

## Files

- `manifest.json` - extension manifest (MV3)
- `popup.html|css|js` - configuration UI
- `glossary.html|js` - glossary editor
- `content.js|css` - page cloning + DOM translation + UI
- `background.js` - model call + prompt + optional chunking logic

