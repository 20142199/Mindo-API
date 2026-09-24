export type NewsSourceDefinition = {
  key: string;
  allowedHosts: string[];
  articlePaths: RegExp[];
  contentSelectors: string[];
};

export const NEWS_SOURCE_DEFINITIONS: Record<string, NewsSourceDefinition> = {
  investing: {
    key: 'investing',
    allowedHosts: ['investing.com', 'www.investing.com'],
    articlePaths: [/^\/news\/(?:[^/]+\/)?[^/]+-\d+\/?$/i],
    contentSelectors: ['[data-test="article-content"]', '.article_WYSIWYG__O0uhw', '.articlePage'],
  },
  forex_factory: {
    key: 'forex_factory',
    allowedHosts: ['forexfactory.com', 'www.forexfactory.com'],
    articlePaths: [/^\/news\/\d+-[^/]+\/?$/i],
    contentSelectors: ['.news__story', '.flexposts__story', '.story'],
  },
  cme_group: {
    key: 'cme_group',
    allowedHosts: ['cmegroup.com', 'www.cmegroup.com'],
    articlePaths: [/^\/articles\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.html$/i, /^\/news\/[^/]+\.html$/i],
    contentSelectors: ['.article-body', '.cmp-text', '.article-content'],
  },
  ice: {
    key: 'ice',
    allowedHosts: ['ice.com', 'www.ice.com'],
    articlePaths: [/^\/insights\/.+/i, /^\/news-and-events\/press-releases\/.+/i],
    contentSelectors: ['.article-body', '.article-content', '.content-body', '.rich-text'],
  },
  yahoo_finance: {
    key: 'yahoo_finance',
    allowedHosts: ['finance.yahoo.com'],
    articlePaths: [/^\/news\/(?!sign-up-for-yahoo-finances-)[^/]+\.html$/i, /^\/(?:markets|personal-finance|tech|economy)\/.+\/articles\/[^/]+\.html$/i],
    contentSelectors: ['.article-body', '.body', '[data-testid="article-body"]'],
  },
  federal_reserve: {
    key: 'federal_reserve',
    allowedHosts: ['federalreserve.gov', 'www.federalreserve.gov'],
    articlePaths: [/^\/newsevents\/pressreleases\/[a-z]+\d{8}[a-z]?\.htm$/i, /^\/newsevents\/speech\/[a-z]+\d{8}[a-z]?\.htm$/i],
    contentSelectors: ['#article', '.col-xs-12.col-sm-8.col-md-8', '.press-release'],
  },
  ecb: {
    key: 'ecb',
    allowedHosts: ['ecb.europa.eu', 'www.ecb.europa.eu'],
    articlePaths: [/^\/press\/pr\/date\/\d{4}\/html\/ecb\.[^/]+\.html$/i],
    contentSelectors: ['main .section', '.ecb-pressContent', '.content-box'],
  },
  imf: {
    key: 'imf',
    allowedHosts: ['imf.org', 'www.imf.org'],
    articlePaths: [/^\/en\/News\/Articles\/.+/i, /^\/en\/News\/Press-Releases\/.+/i],
    contentSelectors: ['.article-content', '.news-article', '.page-content'],
  },
  world_bank: {
    key: 'world_bank',
    allowedHosts: ['worldbank.org', 'www.worldbank.org'],
    articlePaths: [/^\/en\/news\/(?:press-release|feature|speech|immersive-story)\/.+/i],
    contentSelectors: ['.lp__body_content', '.news-content', '.content-body', '.parsys'],
  },
  opec: {
    key: 'opec',
    allowedHosts: ['opec.org', 'www.opec.org'],
    articlePaths: [/^\/pr-detail\/.+\.html$/i, /^\/news-and-events\/.+/i],
    contentSelectors: ['.article-detail', '.detail-content', '.news-detail', '.content'],
  },
};

export function sourceDefinition(key: string) {
  return NEWS_SOURCE_DEFINITIONS[key];
}

export function isAllowedArticleUrl(definition: NewsSourceDefinition, value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !definition.allowedHosts.includes(host)) return false;
    return definition.articlePaths.some((pattern) => pattern.test(url.pathname));
  } catch {
    return false;
  }
}
