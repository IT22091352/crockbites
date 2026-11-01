import type { APIRoute } from 'astro';
import { getAllRecipes, recipeUrl } from '../utils/recipes';
import { site } from '../config/site';

export const prerender = false;

function escapeXml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async () => {
  const recipes = await getAllRecipes(false); // Only published (tested) recipes
  const itemsXml = recipes
    .map((r) => {
      const d = r.data;
      const url = new URL(recipeUrl(r), site.url).href;
      const pubDateRfc822 = d.pubDate instanceof Date
        ? d.pubDate.toUTCString()
        : new Date(d.pubDate || Date.now()).toUTCString();

      return `    <item>
      <title>${escapeXml(d.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <description>${escapeXml(d.description)}</description>
      <pubDate>${pubDateRfc822}</pubDate>
      <category>${escapeXml(d.category)}</category>
    </item>`;
    })
    .join('\n');

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(site.name)}</title>
    <description>${escapeXml(site.description)}</description>
    <link>${escapeXml(site.url)}</link>
    <atom:link href="${escapeXml(new URL('/rss.xml', site.url).href)}" rel="self" type="application/rss+xml" />
    <language>en-US</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itemsXml}
  </channel>
</rss>`;

  return new Response(rssXml.trim(), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
};

