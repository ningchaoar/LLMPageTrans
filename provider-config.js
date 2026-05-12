(function(global) {
  const DEFAULT_PROVIDER_ID = 'modelhub';

  const PROVIDER_DEFINITIONS = {
    modelhub: {
      id: 'modelhub',
      label: 'ModelHub',
      description: '当前默认接入方式，使用查询参数 ak 认证。',
      baseUrlLabel: 'API URL',
      apiKeyLabel: 'API Key (ak)',
      modelLabel: 'Model Name',
      defaultConfig: {
        baseUrl: 'https://aidp.bytedance.net/api/modelhub/online/v2/crawl',
        apiKey: '',
        modelName: 'gpt-5.4-2026-03-05',
        inputPricePerMillion: '',
        outputPricePerMillion: ''
      },
      placeholders: {
        baseUrl: 'https://aidp.bytedance.net/api/modelhub/online/v2/crawl',
        apiKey: 'your_ak_here',
        modelName: 'gpt-5.4-2026-03-05'
      }
    },
    standard: {
      id: 'standard',
      label: 'Standard Bearer',
      description: '标准 Bearer Token 模式，手动填写 URL、API Key 和 Model Name，可用于 DeepSeek 等兼容接口。',
      baseUrlLabel: 'API URL',
      apiKeyLabel: 'API Key',
      modelLabel: 'Model Name',
      defaultConfig: {
        baseUrl: '',
        apiKey: '',
        modelName: '',
        inputPricePerMillion: '',
        outputPricePerMillion: ''
      },
      placeholders: {
        baseUrl: 'https://api.deepseek.com/chat/completions',
        apiKey: 'sk-...',
        modelName: 'deepseek-v4-pro'
      }
    }
  };

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getProviderDefinition(providerId) {
    return PROVIDER_DEFINITIONS[providerId] || PROVIDER_DEFINITIONS[DEFAULT_PROVIDER_ID];
  }

  function createDefaultProviderConfig(providerId) {
    return cloneJson(getProviderDefinition(providerId).defaultConfig);
  }

  function normalizeProviderConfigs(rawProviders) {
    const normalized = {};

    Object.keys(PROVIDER_DEFINITIONS).forEach((providerId) => {
      normalized[providerId] = {
        ...createDefaultProviderConfig(providerId),
        ...(rawProviders && rawProviders[providerId] ? rawProviders[providerId] : {})
      };
    });

    return normalized;
  }

  function migrateLegacyModelHubConfig(items, providers) {
    if (!items) {
      return providers;
    }

    const nextProviders = cloneJson(providers);
    const modelhubConfig = nextProviders.modelhub;

    if (items.apiUrl && (!modelhubConfig.baseUrl || modelhubConfig.baseUrl === PROVIDER_DEFINITIONS.modelhub.defaultConfig.baseUrl)) {
      modelhubConfig.baseUrl = items.apiUrl;
    }

    if (items.apiKey && !modelhubConfig.apiKey) {
      modelhubConfig.apiKey = items.apiKey;
    }

    if (items.modelName && (!modelhubConfig.modelName || modelhubConfig.modelName === PROVIDER_DEFINITIONS.modelhub.defaultConfig.modelName)) {
      modelhubConfig.modelName = items.modelName;
    }

    if (items.inputPricePerMillion !== undefined && items.inputPricePerMillion !== '' && modelhubConfig.inputPricePerMillion === '') {
      modelhubConfig.inputPricePerMillion = items.inputPricePerMillion;
    }

    if (items.outputPricePerMillion !== undefined && items.outputPricePerMillion !== '' && modelhubConfig.outputPricePerMillion === '') {
      modelhubConfig.outputPricePerMillion = items.outputPricePerMillion;
    }

    return nextProviders;
  }

  function migrateLegacyStandardConfig(items, providers) {
    if (!items) {
      return providers;
    }

    const nextProviders = cloneJson(providers);
    const standardConfig = nextProviders.standard;
    const openrouterConfig = items.providers && items.providers.openrouter ? items.providers.openrouter : null;

    if (openrouterConfig) {
      if (openrouterConfig.baseUrl && !standardConfig.baseUrl) {
        standardConfig.baseUrl = openrouterConfig.baseUrl;
      }
      if (openrouterConfig.apiKey && !standardConfig.apiKey) {
        standardConfig.apiKey = openrouterConfig.apiKey;
      }
      if (openrouterConfig.modelName && !standardConfig.modelName) {
        standardConfig.modelName = openrouterConfig.modelName;
      }
      if (openrouterConfig.inputPricePerMillion !== undefined && openrouterConfig.inputPricePerMillion !== '' && standardConfig.inputPricePerMillion === '') {
        standardConfig.inputPricePerMillion = openrouterConfig.inputPricePerMillion;
      }
      if (openrouterConfig.outputPricePerMillion !== undefined && openrouterConfig.outputPricePerMillion !== '' && standardConfig.outputPricePerMillion === '') {
        standardConfig.outputPricePerMillion = openrouterConfig.outputPricePerMillion;
      }
    }

    return nextProviders;
  }

  function getNormalizedProviderState(items) {
    const normalizedProviders = normalizeProviderConfigs(items && items.providers);
    const providers = migrateLegacyStandardConfig(items, migrateLegacyModelHubConfig(items, normalizedProviders));
    const selectedProvider = items && items.selectedProvider === 'openrouter'
      ? 'standard'
      : (items && PROVIDER_DEFINITIONS[items.selectedProvider]
        ? items.selectedProvider
        : DEFAULT_PROVIDER_ID);

    return {
      selectedProvider,
      providers
    };
  }

  global.DEFAULT_PROVIDER_ID = DEFAULT_PROVIDER_ID;
  global.PROVIDER_DEFINITIONS = PROVIDER_DEFINITIONS;
  global.getProviderDefinition = getProviderDefinition;
  global.createDefaultProviderConfig = createDefaultProviderConfig;
  global.normalizeProviderConfigs = normalizeProviderConfigs;
  global.getNormalizedProviderState = getNormalizedProviderState;
})(globalThis);
