# CrockBites

Easy slow cooker recipes and everyday meals. *Good Food. Less Fuss.*

A static recipe blog built with **Astro 7, TypeScript and Tailwind CSS 4**. It builds to plain HTML in `dist/` and needs no server, database or paid service, so it fits the Cloudflare Pages free plan (subject to Cloudflare's current limits).

> **Status:** not deployed, domain not connected, no analytics or ads active. The 8 starter recipes are **editorial drafts** that nobody has cooked yet, with placeholder illustrations instead of photos. See [Remaining manual steps](#remaining-manual-steps).

## Quick start

Requires **Node.js 22.23.4 or newer** (Astro 7 enforces this) and npm.

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # outputs ./dist
npm run preview    # serve the production build locally
npm run check      # TypeScript / Astro diagnostics
npm run verify     # check + build + link/SEO crawl + DOM smoke tests
```

## What is included

| Area | Where |
|---|---|
| Pages: home, all recipes (paginated), recipe detail, categories and hubs, search, about, contact, privacy, terms, cookies and advertising, 404, two guides | `src/pages/` |
| Sitemap and robots | `src/pages/sitemap.xml.ts`, `src/pages/robots.txt.ts` |
| Layouts | `src/layouts/` |
| Components (header, footer, logo, RecipeCard, RecipeDetail, AdSlot, pagination, breadcrumbs, SEO head) | `src/components/` |
| Recipe schema and 8 draft recipes | `src/content.config.ts`, `src/content/recipes/*.md` |
| Site settings (name, email, ads, analytics, newsletter) | `src/config/site.ts` |
| Categories and nav hubs | `src/data/categories.ts` |
| Design tokens, print styles | `src/styles/global.css` |
| Logo, icons, favicon | `public/images/`, `public/favicon.svg` |
| Keyword research outputs | `research/`, `docs/content-roadmap.md` |
| Guides | `docs/` |

## Adding a recipe

Create `src/content/recipes/<slug>.md`. Copy any existing recipe as a template. The file name is the URL: `/recipe/<slug>/`. The build fails with a clear message if a required field is missing or malformed.

For the complete, beginner-friendly publishing workflow—including a copy-paste template, image instructions, draft review process, and the fields that control listings and SEO—see [docs/recipe-publishing.md](docs/recipe-publishing.md).

Key fields: `title`, `description` (200 characters max), `category` (one of the ids in `src/data/categories.ts`), `tags`, `image` and `imageAlt`, `prepMinutes`, `cookMinutes`, `servings`, `ingredients`, `instructions`, plus optional `tips`, `substitutions`, `storage`, `equipment`, `foodSafety`, `related`, `featured`, `popularRank`, `nutrition`.

- An ingredient is `{ quantity, unit, item, note, alt, group }`. Use singular units (`cup`, `clove`); plurals are generated. For countable items without a unit, add `itemPlural`. `alt` holds a metric hint such as `(900 g)` and is hidden when the serving size is changed.
- `nutrition` must only hold real, calculated values, with a `source`. Leave it out otherwise. It is never invented, and no ratings or reviews exist anywhere in the data model.
- The text below the front matter is the recipe introduction.

### Draft versus tested

Every recipe starts with `reviewStatus: draft`. Draft recipes show a "Draft" label and an on-page notice, are marked `noindex`, and are left out of the sitemap. After you cook and verify a recipe, change it to `reviewStatus: tested`, set `updatedDate`, replace the image, and the recipe becomes indexable. To override this behavior set `indexDraftRecipes: true` in `src/config/site.ts` (not recommended).

## Images

The illustrations in `src/assets/` are original generated placeholders (`npm run placeholders`), **not photographs of the recipes**. Replace them with your own photos:

1. Put a JPG, PNG or WebP (at least 1600 px wide, 4:3 works best) in `src/assets/recipes/`.
2. Point the recipe's `image:` field to it and rewrite `imageAlt` to describe the real photo.
3. Astro then generates responsive WebP sizes automatically. Hero images load eagerly with `fetchpriority="high"`; everything below the fold is lazy-loaded; width and height are always set to prevent layout shift.

Never hotlink images from other sites, and only use photos you took or have a license for.

## Features and how they work

- **Serving scaler:** the recipe card scales ingredient amounts, uses fractions, and pluralizes units. It shows a note that cooking time does not scale proportionally. Metric hints are hidden when scaled.
- **Print:** "Print recipe" prints only the recipe card (ingredients, steps, food safety). Navigation, ads, footer and related content are hidden by print CSS.
- **Search:** `/search/` runs entirely in the browser over title, description, category and tags, with a category filter, URL parameters (`?q=`), an empty state, and an announced result count. Press `/` anywhere to jump to it.
- **Structured data:** `Recipe` and `BreadcrumbList` on recipes, `BreadcrumbList` on other pages, `WebSite` and `Organization` on the homepage only. No ratings, reviews, or nutrition are emitted unless real data exists.
- **Newsletter and contact:** no backend exists, so the footer clearly says the newsletter is not live and offers a working `mailto:` link. Set `PUBLIC_NEWSLETTER_FORM_ACTION` to a real provider's form URL to switch on a working form. The contact page is an email link, not a fake form.
- **Analytics and Search Console:** empty by default. Set `PUBLIC_GA_MEASUREMENT_ID` or `PUBLIC_GSC_VERIFICATION` (see `.env.example`) once you have real values. Add a consent mechanism where the law requires one.
- **AdSense:** `AdSlot` is disabled by default and renders nothing. See [docs/adsense-checklist.md](docs/adsense-checklist.md).

## Deployment

Full step-by-step instructions, including the Namecheap to Cloudflare nameserver change: **[docs/deploy-cloudflare-namecheap.md](docs/deploy-cloudflare-namecheap.md)**.

Short version: connect the Git repo in Cloudflare Pages, build command `npm run build`, output directory `dist`, environment variable `NODE_VERSION=22.23.4`.

## Keyword research

`npm run keywords` rebuilds `research/keyword-ideas.json` and `docs/content-roadmap.md` from the two CSVs in `research/`. Values are copied as-is. Missing values stay empty ("n/a"), and topics with no data in the CSVs (breakfast casserole, chicken dinner) say so rather than being estimated.

## Verification performed on this build

Run in the build environment with Node 22.23.4:

- `astro check`: 0 errors.
- `astro build`: 28 pages built.
- `scripts/check-links.py`: every internal link, image, srcset and `#fragment` resolves; one `<title>`, description, canonical and `<h1>` per page; all JSON-LD blocks parse; all images have alt text and dimensions.
- `tests/dom-smoke.test.cjs` (jsdom): serving scaler, reset and limits, print button wiring, mobile menu open/Escape, and search results and empty state all behave as expected.
- Logo, icons and favicon were rendered and inspected on light and dark backgrounds.
- Colour contrast ratios were calculated (see `docs/brand-guide.md`).

**Not verified** (no real browser or network was available): visual layout on real devices, mobile layout, actual keyboard/screen-reader behavior, print preview output, Lighthouse or Core Web Vitals scores, Google's Rich Results Test, and any deployment. Check these yourself before launch. No performance scores are claimed.

## Remaining manual steps

1. Cook and review each recipe. Adjust quantities and times. Switch `reviewStatus` to `tested`.
2. Replace the placeholder illustrations with real photographs and rewrite the alt text.
3. Set the real contact email in `src/config/site.ts` and create that mailbox.
4. Fill in and review the Privacy, Terms and Cookies pages (all `[...]` brackets), ideally with professional legal input. They are templates, not legal advice.
5. Check that the **CrockBites name** is clear to use. "Crock" is close to the Crock-Pot trademark, so consider a trademark search and professional advice. This is a precaution, not a legal conclusion.
6. Push to Git, create the Cloudflare Pages project, and connect CrockBites.com via Namecheap nameservers.
7. Add the domain to Google Search Console and submit the sitemap.
8. Add real social profile URLs to `site.social` when they exist.
9. Choose a consent platform before enabling analytics or ads for EEA/UK visitors.
10. When eligible, follow the AdSense checklist. Approval is up to Google.
11. Decide on an email provider if you want a real newsletter.

## Credits

Fonts: Fraunces and Figtree (SIL Open Font License), via Fontsource. Icons: Lucide (ISC license). Illustrations and logo: generated for this project by the scripts in `scripts/`.
