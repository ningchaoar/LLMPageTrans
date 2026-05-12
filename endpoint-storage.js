(function(global) {
  const ENDPOINTS_STORAGE_KEY = 'modelEndpointsState';
  const ENDPOINTS_STORAGE_VERSION = 1;
  const DEFAULT_ENDPOINT_TARGET_LANGUAGE = '专业而地道的中文';

  function generateEndpointId() {
    return `endpoint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function createEndpointDraft(mode) {
    const definition = global.getProviderDefinition(mode || global.DEFAULT_PROVIDER_ID);
    return {
      id: generateEndpointId(),
      name: `${definition.label} Endpoint`,
      mode: definition.id,
      baseUrl: definition.defaultConfig.baseUrl || '',
      apiKey: '',
      modelName: definition.defaultConfig.modelName || '',
      targetLang: DEFAULT_ENDPOINT_TARGET_LANGUAGE,
      inputPricePerMillion: definition.defaultConfig.inputPricePerMillion || '',
      outputPricePerMillion: definition.defaultConfig.outputPricePerMillion || ''
    };
  }

  function normalizeEndpoint(endpoint, fallbackMode) {
    const mode = global.PROVIDER_DEFINITIONS[endpoint && endpoint.mode]
      ? endpoint.mode
      : (fallbackMode || global.DEFAULT_PROVIDER_ID);
    const definition = global.getProviderDefinition(mode);
    const draft = createEndpointDraft(mode);

    return {
      ...draft,
      ...(endpoint || {}),
      id: endpoint && endpoint.id ? endpoint.id : generateEndpointId(),
      name: endpoint && endpoint.name ? endpoint.name : `${definition.label} Endpoint`,
      mode,
      baseUrl: endpoint && typeof endpoint.baseUrl === 'string' ? endpoint.baseUrl : draft.baseUrl,
      apiKey: endpoint && typeof endpoint.apiKey === 'string' ? endpoint.apiKey : '',
      modelName: endpoint && typeof endpoint.modelName === 'string' ? endpoint.modelName : draft.modelName,
      targetLang: endpoint && typeof endpoint.targetLang === 'string' && endpoint.targetLang
        ? endpoint.targetLang
        : DEFAULT_ENDPOINT_TARGET_LANGUAGE,
      inputPricePerMillion: endpoint && endpoint.inputPricePerMillion !== undefined ? endpoint.inputPricePerMillion : draft.inputPricePerMillion,
      outputPricePerMillion: endpoint && endpoint.outputPricePerMillion !== undefined ? endpoint.outputPricePerMillion : draft.outputPricePerMillion
    };
  }

  function endpointHasMeaningfulConfig(endpoint) {
    if (!endpoint) {
      return false;
    }

    return Boolean(
      (endpoint.baseUrl && endpoint.baseUrl.trim())
      || (endpoint.apiKey && endpoint.apiKey.trim())
      || (endpoint.modelName && endpoint.modelName.trim())
      || (endpoint.inputPricePerMillion !== undefined && String(endpoint.inputPricePerMillion).trim())
      || (endpoint.outputPricePerMillion !== undefined && String(endpoint.outputPricePerMillion).trim())
    );
  }

  function buildLegacyEndpointsState(syncItems) {
    const providerState = global.getNormalizedProviderState(syncItems || {});
    const endpoints = [];
    const targetLang = syncItems && syncItems.targetLang ? syncItems.targetLang : DEFAULT_ENDPOINT_TARGET_LANGUAGE;

    Object.keys(providerState.providers).forEach((providerId) => {
      const providerConfig = providerState.providers[providerId];
      const definition = global.getProviderDefinition(providerId);
      const endpoint = normalizeEndpoint({
        id: `legacy_${providerId}`,
        name: `${definition.label} Endpoint`,
        mode: providerId,
        baseUrl: providerConfig.baseUrl || '',
        apiKey: providerConfig.apiKey || '',
        modelName: providerConfig.modelName || definition.defaultConfig.modelName || '',
        targetLang,
        inputPricePerMillion: providerConfig.inputPricePerMillion || '',
        outputPricePerMillion: providerConfig.outputPricePerMillion || ''
      }, providerId);

      if (endpointHasMeaningfulConfig(endpoint) || providerId === providerState.selectedProvider) {
        endpoints.push(endpoint);
      }
    });

    if (endpoints.length === 0) {
      endpoints.push(createEndpointDraft(global.DEFAULT_PROVIDER_ID));
    }

    const selectedLegacyMode = syncItems && syncItems.selectedProvider === 'openrouter'
      ? 'standard'
      : (syncItems && syncItems.selectedProvider ? syncItems.selectedProvider : global.DEFAULT_PROVIDER_ID);
    const selectedEndpoint = endpoints.find((endpoint) => endpoint.mode === selectedLegacyMode) || endpoints[0];

    return {
      version: ENDPOINTS_STORAGE_VERSION,
      currentEndpointId: selectedEndpoint.id,
      endpoints
    };
  }

  function normalizeEndpointsState(rawState) {
    if (!rawState || !Array.isArray(rawState.endpoints) || rawState.endpoints.length === 0) {
      const initialEndpoint = createEndpointDraft(global.DEFAULT_PROVIDER_ID);
      return {
        version: ENDPOINTS_STORAGE_VERSION,
        currentEndpointId: initialEndpoint.id,
        endpoints: [initialEndpoint]
      };
    }

    const endpoints = rawState.endpoints.map((endpoint) => normalizeEndpoint(endpoint, endpoint && endpoint.mode));
    const currentEndpointId = endpoints.some((endpoint) => endpoint.id === rawState.currentEndpointId)
      ? rawState.currentEndpointId
      : endpoints[0].id;

    return {
      version: ENDPOINTS_STORAGE_VERSION,
      currentEndpointId,
      endpoints
    };
  }

  function findEndpointById(state, endpointId) {
    const normalizedState = normalizeEndpointsState(state);
    return normalizedState.endpoints.find((endpoint) => endpoint.id === endpointId) || null;
  }

  global.ENDPOINTS_STORAGE_KEY = ENDPOINTS_STORAGE_KEY;
  global.DEFAULT_ENDPOINT_TARGET_LANGUAGE = DEFAULT_ENDPOINT_TARGET_LANGUAGE;
  global.createEndpointDraft = createEndpointDraft;
  global.normalizeEndpoint = normalizeEndpoint;
  global.normalizeEndpointsState = normalizeEndpointsState;
  global.buildLegacyEndpointsState = buildLegacyEndpointsState;
  global.findEndpointById = findEndpointById;
})(globalThis);
