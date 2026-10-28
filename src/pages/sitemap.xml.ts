import type { APIRoute } from 'astro';
import { site } from '../config/site';
import { getAllRecipes, isIndexable, listingPages, recipeUrl } from '../utils/recipes';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export const GET: APIRoute = async () => {
  const all = await getAllRecipes();
  const urls: { loc: string; lastmod?: string }[] = [];
  const add = (path: string, lastmod?: Date) => urls.push({ loc: new URL(path, site.url).href, lastmod: lastmod?.toISOString().slice(0, 10) });

  const newest = all[0]?.data.updatedDate ?? all[0]?.data.pubDate;
  for (const p of ['/', '/recipes/', '/about/', '/contact/', '/guides/slow-cooker-basics/', '/guides/slow-cooker-food-safety/',
    '/privacy-policy/', '/terms-of-use/', '/cookies-and-advertising/']) add(p, p === '/' || p === '/recipes/' ? newest : undefined);

  const pages = Math.ceil(all.length / site.recipesPerPage);
  for (let n = 2; n <= pages; n++) add(`/recipes/${n}/`);

  for (const l of listingPages(all)) {
    if (!l.recipes.length) continue; // empty categories are noindex and left out
    add(`/category/${l.slug}/`);
    for (let n = 2; n <= Math.ceil(l.recipes.length / site.recipesPerPage); n++) add(`/category/${l.slug}/${n}/`);
  }
  for (const r of all) if (isIndexable(r)) add(recipeUrl(r), r.data.updatedDate ?? r.data.pubDate);

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
