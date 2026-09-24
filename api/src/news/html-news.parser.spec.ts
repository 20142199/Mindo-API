import { describe, expect, it } from 'vitest';
import { parseArticleHtml, parseListingHtml } from './html-news.parser';
import { NEWS_SOURCE_DEFINITIONS } from './news-source.definitions';

describe('HTML news parser', () => {
  it('discovers and deduplicates article links', () => {
    const html = `<main><article><a href="/newsevents/pressreleases/monetary20260924a.htm"><h2>Federal Reserve issues a policy statement</h2></a></article><a href="/newsevents/pressreleases/monetary20260924a.htm">Duplicate policy statement</a></main>`;
    const rows = parseListingHtml(html, 'https://www.federalreserve.gov/newsevents/pressreleases.htm', NEWS_SOURCE_DEFINITIONS.federal_reserve);
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toContain('monetary20260924a.htm');
  });

  it('extracts source material from JSON-LD and article HTML', () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"NewsArticle","headline":"A meaningful market update","description":"A concise source description.","datePublished":"2026-09-24T08:00:00Z","author":{"name":"Research Team"},"image":{"url":"/cover.jpg"}}</script></head><body><article><p>${'Market conditions changed during the session. '.repeat(8)}</p><aside>Related story</aside></article></body></html>`;
    const row = parseArticleHtml(html, 'https://www.cmegroup.com/articles/2026/09/24/market-update.html', NEWS_SOURCE_DEFINITIONS.cme_group);
    expect(row.title).toBe('A meaningful market update');
    expect(row.content.length).toBeGreaterThan(200);
    expect(row.author).toBe('Research Team');
    expect(row.imageUrl).toBe('https://www.cmegroup.com/cover.jpg');
  });
});
