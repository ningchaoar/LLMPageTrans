(function(global) {
  function buildStructuredMessage(role, text) {
    return {
      role,
      content: [
        {
          type: 'text',
          text
        }
      ]
    };
  }

  function buildPlainMessage(role, text) {
    return {
      role,
      content: text
    };
  }

  function extractContentFromChoices(data) {
    const message = data && data.choices && data.choices[0] && data.choices[0].message;
    const content = message ? message.content : null;

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => item && item.text ? item.text : '')
        .join('')
        .trim();
    }

    throw new Error('Provider did not return message content');
  }

  function createStructuredRequestBody(model, systemPrompt, userPrompt) {
    return {
      stream: false,
      model,
      max_tokens: 4096,
      reasoning: { effort: 'none' },
      thinking: {type: 'disabled'},
      reasoning_effort: "none",
      messages: [
        buildStructuredMessage('system', systemPrompt),
        buildStructuredMessage('user', userPrompt)
      ]
    };
  }

  function createStandardRequestBody(model, systemPrompt, userPrompt) {
    return {
      model,
      messages: [
        buildPlainMessage('system', systemPrompt),
        buildPlainMessage('user', userPrompt)
      ]
    };
  }

  const PROVIDER_ADAPTERS = {
    modelhub: {
      buildRequest(providerConfig, request) {
        let url = providerConfig.baseUrl;
        if (!url.includes('ak=')) {
          const separator = url.includes('?') ? '&' : '?';
          url = `${url}${separator}ak=${providerConfig.apiKey}`;
        }

        return {
          url,
          options: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(createStructuredRequestBody(request.model, request.systemPrompt, request.userPrompt))
          }
        };
      },
      extractContent(data) {
        return extractContentFromChoices(data);
      }
    },
    standard: {
      buildRequest(providerConfig, request) {
        return {
          url: providerConfig.baseUrl,
          options: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${providerConfig.apiKey}`
            },
            body: JSON.stringify(createStandardRequestBody(request.model, request.systemPrompt, request.userPrompt))
          }
        };
      },
      extractContent(data) {
        return extractContentFromChoices(data);
      }
    }
  };

  function getProviderAdapter(providerId) {
    const adapter = PROVIDER_ADAPTERS[providerId];
    if (!adapter) {
      throw new Error(`Unsupported provider: ${providerId}`);
    }
    return adapter;
  }

  async function sendProviderChatCompletion(providerId, providerConfig, request) {
    const adapter = getProviderAdapter(providerId);
    const fetchRequest = adapter.buildRequest(providerConfig, request);
    const response = await fetch(fetchRequest.url, fetchRequest.options);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return adapter.extractContent(data);
  }

  global.PROVIDER_ADAPTERS = PROVIDER_ADAPTERS;
  global.getProviderAdapter = getProviderAdapter;
  global.sendProviderChatCompletion = sendProviderChatCompletion;
})(globalThis);
