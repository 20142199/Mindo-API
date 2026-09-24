import { load } from 'cheerio';
import { isAllowedArticleUrl, type NewsSourceDefinition } from './news-source.definitions';

const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'aside', 'form', 'button',
  '[aria-hidden="true"]', '[class*="advert"]', '[class*="social"]', '[class*="share"]',
  '[class*="related"]', '[class*="recommend"]', '[class*="newsletter"]', '[class*="cookie"]',
];

export type CrawledArticle = {
  url: string;
  title: string;
  summary: string;
  content: string;
  imageUrl?: string;
  author?: string;
  publishedAt?: Date;
};

function cleanText(value?: string | null) {
  return (value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

function absoluteUrl(value: string | undefined, pageUrl: string) {
  if (!value) return undefined;
  try { return new URL(value, pageUrl).toString(); } catch { return undefined; }
}

function dateValue(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function jsonLdObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdObjects);
  if (!value || typeof value !== 'object') return [];
  const object = value as Record<string, unknown>;
  return [object, ...jsonLdObjects(object['@graph'])];
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return firstString(value[0]);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return firstString(object.url) ?? firstString(object.name);
  }
  return undefined;
}

export function parseListingHtml(html: string, listingUrl: string, definition: NewsSourceDefinition, limit = 20) {
  const $ = load(html);
  const rows = new Map<string, { url: string; title: string }>();
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const url = absoluteUrl(href, listingUrl);
    if (!url || !isAllowedArticleUrl(definition, url)) return;
    const normalized = new URL(url);
    normalized.hash = '';
    normalized.search = '';
    const cleanUrl = normalized.toString();
    const title = cleanText($(element).attr('title') || $(element).find('h1,h2,h3,h4').first().text() || $(element).text());
    if (title.length < 8 || rows.has(cleanUrl)) return;
    rows.set(cleanUrl, { url: cleanUrl, title: title.slice(0, 500) });
  });
  return [...rows.values()].slice(0, limit);
}

export function parseArticleHtml(html: string, pageUrl: string, definition: NewsSourceDefinition): CrawledArticle {
  const $ = load(html);
  const jsonLd = $('script[type="application/ld+json"]').toArray().flatMap((element) => {
    try { return jsonLdObjects(JSON.parse($(element).text())); } catch { return []; }
  });
  const articleLd = jsonLd.find((item) => {
    const type = item['@type'];
    const values = Array.isArray(type) ? type : [type];
    return values.some((value) => typeof value === 'string' && /Article|NewsArticle|Report|BlogPosting/i.test(value));
  });

  let title = cleanText(
    firstString(articleLd?.headline)
    || $('meta[property="og:title"]').attr('content')
    || $('meta[name="twitter:title"]').attr('content')
    || $('h1').first().text()
    || $('title').text(),
  );
  if (definition.key === 'opec' && /^Organization of the Petroleum Exporting Countries$/i.test(title)) {
    title = cleanText($('.article-detail h1,.article-detail h2,.article-detail h3,.detail-content h1,.detail-content h2,.detail-content h3,main h1,main h2,main h3').first().text() || $('h3').first().text());
  }
  const description = cleanText(
    firstString(articleLd?.description)
    || $('meta[name="description"]').attr('content')
    || $('meta[property="og:description"]').attr('content'),
  );
  const imageUrl = absoluteUrl(
    firstString(articleLd?.image)
    ?? $('meta[property="og:image"]').attr('content')
    ?? $('meta[name="twitter:image"]').attr('content'),
    pageUrl,
  );
  const author = cleanText(
    firstString(articleLd?.author)
    ?? $('meta[name="author"]').attr('content')
    ?? $('[rel="author"]').first().text()
    ?? $('[class*="author"]').first().text(),
  ) || undefined;
  const publishedAt = dateValue(
    firstString(articleLd?.datePublished)
    ?? $('meta[property="article:published_time"]').attr('content')
    ?? $('time[datetime]').first().attr('datetime'),
  );

  let content = cleanText(firstString(articleLd?.articleBody));
  if (content.length < 200) {
    const selector = [...definition.contentSelectors, '[itemprop="articleBody"]', 'article', 'main'].find((candidate) => $(candidate).first().length);
    if (selector) {
      const root = $(selector).first().clone();
      root.find(REMOVE_SELECTORS.join(',')).remove();
      const blocks: string[] = [];
      root.find('p,h2,h3,h4,blockquote,li').each((_, element) => {
        const value = cleanText($(element).text());
        if (value.length >= 20 && !blocks.includes(value)) blocks.push(value);
      });
      content = cleanText(blocks.join('\n\n'));
      if (content.length < 200) content = cleanText(root.text());
    }
  }

  if (title.length < 5) throw new Error('Không đọc được tiêu đề bài viết');
  if (content.length < 120) throw new Error('Không đọc được thân bài viết từ HTML');
  const summary = description || content.slice(0, 480).replace(/\s+\S*$/, '');
  return { url: pageUrl, title: title.slice(0, 500), summary: summary.slice(0, 1000), content: content.slice(0, 80_000), imageUrl, author, publishedAt };
}
