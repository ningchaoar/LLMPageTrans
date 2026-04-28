const defaultGlossary = `# 无需翻译
- token

# 特定翻译
- Agent: 智能体`;

document.addEventListener('DOMContentLoaded', () => {
  const textarea = document.getElementById('glossaryText');
  const saveBtn = document.getElementById('saveBtn');
  const status = document.getElementById('status');

  // Load saved glossary from storage
  chrome.storage.sync.get(['glossaryMarkdown'], (items) => {
    textarea.value = items.glossaryMarkdown || defaultGlossary;
  });

  // Save glossary to storage
  saveBtn.addEventListener('click', () => {
    chrome.storage.sync.set({ glossaryMarkdown: textarea.value }, () => {
      status.textContent = '保存成功！(Saved successfully!)';
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  });
});