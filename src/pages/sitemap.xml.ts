import type { APIRoute } from 'astro';

export const prerender = false;

import { site } from '../config/site.ts';
import { getDb } from '../lib/db.ts';
import { getAllRecipes, isIndexable, listingPages, recipeUrl } from '../utils/recipes.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export const GET: APIRoute = async (context) => {
  const db = await getDb(context?.locals);
  const all = await getAllRecipes(false, db);
  const urls: { loc: string; lastmod?: string; changefreq?: string; priority?: string }[] = [];
  const add = (path: string, lastmod?: Date | string, changefreq?: string, priority?: string) => {
    let lastmodStr: string | undefined = undefined;
    if (lastmod) {
      const d = lastmod instanceof Date ? lastmod : new Date(lastmod);
      if (!isNaN(d.getTime())) {
        lastmodStr = d.toISOString().slice(0, 10);
      }
    }
    urls.push({
      loc: new URL(path, site.url).href,
      lastmod: lastmodStr,
      changefreq,
      priority,
    });
  };

  const newest = all[0]?.data.updatedDate ?? all[0]?.data.pubDate;
  add('/', newest, 'daily', '1.0');
  add('/recipes/', newest, 'daily', '0.9');

  const pages = Math.ceil(all.length / site.recipesPerPage);
  for (let n = 2; n <= pages; n++) add(`/recipes/${n}/`, newest, 'weekly', '0.7');

  for (const l of listingPages(all)) {
    if (!l.recipes.length) continue; // empty categories are noindex and left out
    add(`/category/${l.slug}/`, newest, 'weekly', '0.8');
    for (let n = 2; n <= Math.ceil(l.recipes.length / site.recipesPerPage); n++) {
      add(`/category/${l.slug}/${n}/`, newest, 'weekly', '0.6');
    }
  }

  for (const r of all) {
    if (isIndexable(r)) {
      add(recipeUrl(r), r.data.updatedDate ?? r.data.pubDate, 'weekly', '0.8');
    }
  }

  add('/guides/slow-cooker-basics/', undefined, 'monthly', '0.6');
  add('/guides/slow-cooker-food-safety/', undefined, 'monthly', '0.6');
  add('/about/', undefined, 'monthly', '0.4');
  add('/contact/', undefined, 'monthly', '0.4');
  add('/privacy-policy/', undefined, 'yearly', '0.3');
  add('/terms-of-use/', undefined, 'yearly', '0.3');
  add('/cookies-and-advertising/', undefined, 'yearly', '0.3');

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${
            u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ''
          }${u.priority ? `<priority>${u.priority}</priority>` : ''}</url>`
      )
      .join('\n') +
    '\n</urlset>\n';
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
};
