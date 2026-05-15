(function(global) {
  function safeParseUrl(url) {
    try {
      return new URL(String(url || ''));
    } catch (_) {
      return null;
    }
  }

  function tryDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }

  function isArxivPdfRoute(parsedUrl) {
    if (!parsedUrl) {
      return false;
    }

    const host = parsedUrl.hostname.toLowerCase();
    return (host === 'arxiv.org' || host === 'www.arxiv.org' || host === 'export.arxiv.org')
      && parsedUrl.pathname.toLowerCase().startsWith('/pdf/');
  }

  function looksLikePdfUrl(url) {
    const value = String(url || '').trim();
    if (!value) {
      return false;
    }

    const parsed = safeParseUrl(value);
    if (parsed) {
      const pathname = parsed.pathname.toLowerCase();
      return pathname.endsWith('.pdf') || isArxivPdfRoute(parsed);
    }

    const lower = value.toLowerCase();
    if (lower.endsWith('.pdf') || lower.includes('.pdf?') || lower.includes('.pdf#')) {
      return true;
    }

    return false;
  }

  function isFetchablePdfCandidateUrl(url) {
    const value = String(url || '').trim().toLowerCase();
    return value.startsWith('http://')
      || value.startsWith('https://')
      || value.startsWith('file://')
      || value.startsWith('blob:');
  }

  function tabTitleLooksLikePdf(tab) {
    const title = String(tab && tab.title ? tab.title : '').trim().toLowerCase();
    return title.endsWith('.pdf') || title.includes('.pdf ');
  }

  function firstPdfUrlFromParams(params) {
    const priorityKeys = ['src', 'source', 'file', 'url'];

    for (const key of priorityKeys) {
      const value = params.get(key);
      if (looksLikePdfUrl(value)) {
        return value;
      }
    }

    for (const value of params.values()) {
      if (looksLikePdfUrl(value)) {
        return value;
      }
    }

    return '';
  }

  function extractPdfSourceFromTab(tab) {
    const tabUrl = tab && tab.url ? tab.url : '';
    if (looksLikePdfUrl(tabUrl)) {
      return tabUrl;
    }

    if (isFetchablePdfCandidateUrl(tabUrl) && tabTitleLooksLikePdf(tab)) {
      return tabUrl;
    }

    const parsed = safeParseUrl(tabUrl);
    if (!parsed) {
      return '';
    }

    const fromSearch = firstPdfUrlFromParams(parsed.searchParams);
    if (fromSearch) {
      return fromSearch;
    }

    const hashValue = parsed.hash ? parsed.hash.slice(1) : '';
    if (!hashValue) {
      return '';
    }

    const hashParams = new URLSearchParams(hashValue.startsWith('?') ? hashValue.slice(1) : hashValue);
    const fromHashParams = firstPdfUrlFromParams(hashParams);
    if (fromHashParams) {
      return fromHashParams;
    }

    const decodedHash = tryDecodeURIComponent(hashValue);
    if (looksLikePdfUrl(decodedHash)) {
      return decodedHash;
    }

    return '';
  }

  const api = {
    extractPdfSourceFromTab,
    looksLikePdfUrl
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  global.PdfSourceUtils = api;
})(globalThis);
