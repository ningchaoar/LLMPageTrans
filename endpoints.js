document.addEventListener('DOMContentLoaded', () => {
  const endpointList = document.getElementById('endpointList');
  const createEndpointBtn = document.getElementById('createEndpointBtn');
  const setActiveBtn = document.getElementById('setActiveBtn');
  const deleteEndpointBtn = document.getElementById('deleteEndpointBtn');
  const saveEndpointBtn = document.getElementById('saveEndpointBtn');
  const status = document.getElementById('status');

  const endpointNameInput = document.getElementById('endpointName');
  const endpointModeInput = document.getElementById('endpointMode');
  const modeDescription = document.getElementById('modeDescription');
  const endpointUrlLabel = document.getElementById('endpointUrlLabel');
  const endpointUrlInput = document.getElementById('endpointUrl');
  const endpointApiKeyLabel = document.getElementById('endpointApiKeyLabel');
  const endpointApiKeyInput = document.getElementById('endpointApiKey');
  const endpointModelLabel = document.getElementById('endpointModelLabel');
  const endpointModelNameInput = document.getElementById('endpointModelName');
  const endpointTargetLangInput = document.getElementById('endpointTargetLang');
  const endpointInputPriceInput = document.getElementById('endpointInputPrice');
  const endpointOutputPriceInput = document.getElementById('endpointOutputPrice');

  let endpointsState = normalizeEndpointsState(null);
  let currentEditingId = null;

  function setStatus(message, isError) {
    status.textContent = message || '';
    status.style.color = isError ? '#b91c1c' : '#166534';
  }

  function storageGet(area, keys) {
    return new Promise((resolve, reject) => {
      chrome.storage[area].get(keys, (items) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(items);
      });
    });
  }

  function storageSet(area, value) {
    return new Promise((resolve, reject) => {
      chrome.storage[area].set(value, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  }

  function storageRemove(area, keys) {
    return new Promise((resolve, reject) => {
      chrome.storage[area].remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  }

  function renderModeOptions() {
    endpointModeInput.innerHTML = '';
    Object.keys(PROVIDER_DEFINITIONS).forEach((mode) => {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = getProviderDefinition(mode).label;
      endpointModeInput.appendChild(option);
    });
  }

  function applyModeToForm(mode) {
    const definition = getProviderDefinition(mode);
    modeDescription.textContent = definition.description;
    endpointUrlLabel.textContent = `${definition.baseUrlLabel}`;
    endpointApiKeyLabel.textContent = `${definition.apiKeyLabel}`;
    endpointModelLabel.textContent = `${definition.modelLabel}`;
    endpointUrlInput.placeholder = definition.placeholders.baseUrl;
    endpointApiKeyInput.placeholder = definition.placeholders.apiKey;
    endpointModelNameInput.placeholder = definition.placeholders.modelName;
  }

  function renderEndpointList() {
    endpointList.innerHTML = '';

    endpointsState.endpoints.forEach((endpoint) => {
      const item = document.createElement('div');
      item.className = `endpoint-item${endpoint.id === currentEditingId ? ' active' : ''}`;
      item.dataset.endpointId = endpoint.id;
      const definition = getProviderDefinition(endpoint.mode);
      const isCurrent = endpoint.id === endpointsState.currentEndpointId;

      item.innerHTML = `
        <div class="endpoint-name">${endpoint.name || '未命名接入点'}${isCurrent ? ' · 当前使用' : ''}</div>
        <div class="endpoint-meta">${definition.label}</div>
        <div class="endpoint-meta">${endpoint.modelName || '未配置模型'} / ${endpoint.targetLang || '未配置语言'}</div>
      `;

      item.addEventListener('click', () => {
        currentEditingId = endpoint.id;
        applyEndpointToForm(endpoint);
        renderEndpointList();
        setStatus('', false);
      });

      endpointList.appendChild(item);
    });
  }

  function applyEndpointToForm(endpoint) {
    currentEditingId = endpoint.id;
    endpointNameInput.value = endpoint.name || '';
    endpointModeInput.value = endpoint.mode;
    applyModeToForm(endpoint.mode);
    endpointUrlInput.value = endpoint.baseUrl || '';
    endpointApiKeyInput.value = endpoint.apiKey || '';
    endpointModelNameInput.value = endpoint.modelName || '';
    endpointTargetLangInput.value = endpoint.targetLang || DEFAULT_ENDPOINT_TARGET_LANGUAGE;
    endpointInputPriceInput.value = endpoint.inputPricePerMillion || '';
    endpointOutputPriceInput.value = endpoint.outputPricePerMillion || '';
  }

  function getEditingEndpoint() {
    return endpointsState.endpoints.find((endpoint) => endpoint.id === currentEditingId) || null;
  }

  function buildEndpointFromForm(existingEndpointId) {
    return normalizeEndpoint({
      id: existingEndpointId || undefined,
      name: endpointNameInput.value.trim() || `${getProviderDefinition(endpointModeInput.value).label} Endpoint`,
      mode: endpointModeInput.value,
      baseUrl: endpointUrlInput.value.trim(),
      apiKey: endpointApiKeyInput.value.trim(),
      modelName: endpointModelNameInput.value.trim(),
      targetLang: endpointTargetLangInput.value.trim() || DEFAULT_ENDPOINT_TARGET_LANGUAGE,
      inputPricePerMillion: endpointInputPriceInput.value.trim(),
      outputPricePerMillion: endpointOutputPriceInput.value.trim()
    }, endpointModeInput.value);
  }

  async function persistEndpointsState() {
    endpointsState = normalizeEndpointsState(endpointsState);
    await storageSet('local', {
      [ENDPOINTS_STORAGE_KEY]: endpointsState
    });
    await storageRemove('sync', [
      'selectedProvider',
      'providers',
      'apiUrl',
      'apiKey',
      'modelName',
      'targetLang',
      'inputPricePerMillion',
      'outputPricePerMillion'
    ]);
  }

  function startNewEndpoint(mode) {
    const draft = createEndpointDraft(mode || endpointModeInput.value || DEFAULT_PROVIDER_ID);
    currentEditingId = draft.id;
    applyEndpointToForm(draft);
    setStatus('已创建新接入点草稿，保存后生效。', false);
  }

  createEndpointBtn.addEventListener('click', () => {
    startNewEndpoint(DEFAULT_PROVIDER_ID);
  });

  endpointModeInput.addEventListener('change', () => {
    const editingEndpoint = getEditingEndpoint();
    const replacement = createEndpointDraft(endpointModeInput.value);
    applyModeToForm(endpointModeInput.value);
    if (editingEndpoint && !editingEndpoint.baseUrl && !editingEndpoint.modelName && !editingEndpoint.apiKey) {
      endpointUrlInput.value = replacement.baseUrl || '';
      endpointModelNameInput.value = replacement.modelName || '';
    }
  });

  saveEndpointBtn.addEventListener('click', async () => {
    try {
      const nextEndpoint = buildEndpointFromForm(currentEditingId);
      const existingIndex = endpointsState.endpoints.findIndex((endpoint) => endpoint.id === nextEndpoint.id);

      if (existingIndex >= 0) {
        endpointsState.endpoints[existingIndex] = nextEndpoint;
      } else {
        endpointsState.endpoints.push(nextEndpoint);
      }

      if (!endpointsState.currentEndpointId) {
        endpointsState.currentEndpointId = nextEndpoint.id;
      }

      await persistEndpointsState();
      currentEditingId = nextEndpoint.id;
      renderEndpointList();
      applyEndpointToForm(nextEndpoint);
      setStatus('接入点已保存。', false);
    } catch (error) {
      console.error('Save endpoint failed:', error);
      setStatus(`保存失败：${error.message}`, true);
    }
  });

  setActiveBtn.addEventListener('click', async () => {
    const endpoint = getEditingEndpoint();
    if (!endpoint) {
      setStatus('请先选择一个接入点。', true);
      return;
    }

    endpointsState.currentEndpointId = endpoint.id;
    try {
      await persistEndpointsState();
      renderEndpointList();
      setStatus(`已切换到 ${endpoint.name}。`, false);
    } catch (error) {
      console.error('Set active endpoint failed:', error);
      setStatus(`设置失败：${error.message}`, true);
    }
  });

  deleteEndpointBtn.addEventListener('click', async () => {
    const endpoint = getEditingEndpoint();
    if (!endpoint) {
      setStatus('请先选择一个接入点。', true);
      return;
    }

    if (endpointsState.endpoints.length <= 1) {
      setStatus('至少保留一个接入点。', true);
      return;
    }

    const confirmed = window.confirm(`确定删除接入点“${endpoint.name}”吗？`);
    if (!confirmed) {
      return;
    }

    endpointsState.endpoints = endpointsState.endpoints.filter((item) => item.id !== endpoint.id);
    if (endpointsState.currentEndpointId === endpoint.id) {
      endpointsState.currentEndpointId = endpointsState.endpoints[0].id;
    }

    try {
      await persistEndpointsState();
      currentEditingId = endpointsState.currentEndpointId;
      applyEndpointToForm(getEditingEndpoint());
      renderEndpointList();
      setStatus('接入点已删除。', false);
    } catch (error) {
      console.error('Delete endpoint failed:', error);
      setStatus(`删除失败：${error.message}`, true);
    }
  });

  async function loadState() {
    const [localItems, syncItems] = await Promise.all([
      storageGet('local', [ENDPOINTS_STORAGE_KEY]),
      storageGet('sync', [
        'selectedProvider',
        'providers',
        'apiUrl',
        'apiKey',
        'modelName',
        'targetLang',
        'inputPricePerMillion',
        'outputPricePerMillion'
      ])
    ]);

    const localState = localItems[ENDPOINTS_STORAGE_KEY];
    endpointsState = localState
      ? normalizeEndpointsState(localState)
      : buildLegacyEndpointsState(syncItems);

    await persistEndpointsState();

    currentEditingId = endpointsState.currentEndpointId;
    renderEndpointList();
    applyEndpointToForm(findEndpointById(endpointsState, currentEditingId));
  }

  renderModeOptions();
  loadState().catch((error) => {
    console.error('Load endpoints failed:', error);
    setStatus(`初始化失败：${error.message}`, true);
  });
});
