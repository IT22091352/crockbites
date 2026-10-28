# Publishing a recipe

CrockBites uses Astro content collections. You publish a recipe by adding one
Markdown file; the existing recipe page, cards, category pages, search index,
breadcrumbs, metadata, sitemap entry, and Recipe JSON-LD are generated during
the build. You do not create a new `.astro` page for each recipe.

## 1. Create the Markdown file

Copy an existing file from `src/content/recipes/`, then rename it using a
lowercase, hyphen-separated slug:

```text
src/content/recipes/slow-cooker-chicken-tacos.md
```

The filename becomes the URL:

```text
/recipe/slow-cooker-chicken-tacos/
```

You can set `slug` explicitly in the frontmatter when you need a URL different
from the filename. Slugs must contain only lowercase letters, numbers, and
single hyphens, and every slug must be unique.

## 2. Add the frontmatter

Put this YAML block at the very top of the file. The schema validates it during
`npm run check` and `npm run build`.

```yaml
---
title: "Slow Cooker Chicken Tacos"
slug: slow-cooker-chicken-tacos
description: "Tender chicken with smoky spices for an easy taco-night filling."
category: slow-cooker-chicken
tags: [slow cooker, chicken, tacos, easy dinner]
image: ../../assets/recipes/slow-cooker-chicken-tacos.jpg
imageAlt: "Shredded slow cooker chicken in a bowl with lime and cilantro."
author: CrockBites
pubDate: 2026-10-28
prepMinutes: 15
cookMinutes: 240
servings: 6
ingredients:
  - { quantity: 2, unit: lb, alt: "(900 g)", item: "boneless skinless chicken thighs" }
  - { quantity: 1, unit: cup, item: "salsa" }
instructions:
  - title: "Add the ingredients"
    text: "Place the chicken and salsa in the slow cooker."
  - title: "Cook"
    text: "Cover and cook until tender and safe to eat."
tips:
  - "Shred the chicken directly in the slow cooker before serving."
storage:
  fridge: "Refrigerate in a covered container for 3 to 4 days."
  freezer: "Freeze in portions for up to 3 months."
  reheating: "Reheat until steaming hot throughout."
reviewStatus: draft
---

Write a useful introduction here. Explain what the recipe tastes like,
why it is useful, and any preparation detail readers need before the recipe card.
```

### Required fields

`title`, `description`, `category`, `image`, `imageAlt`, `pubDate`,
`prepMinutes`, `cookMinutes`, `servings`, `ingredients`, and `instructions`
are required. `description` must be 200 characters or fewer.

Choose `category` from the IDs in `src/data/categories.ts`:

```text
slow-cooker-chicken
beef-pork
soups-stews
easy-dinners
breakfast
vegetarian
desserts-baking
```

Each ingredient needs an `item`. Add `quantity` and `unit` when the amount
should scale with servings. Use `scale: false` for items such as salt added to
taste. Ingredient `group` values create headings in the recipe card.

Each instruction needs `text`; `title` is optional but recommended. Keep
instructions clear and sequential.

### Optional fields

- `updatedDate`: set this when a published recipe changes.
- `totalMinutes`: overrides the automatic preparation-plus-cooking total.
- `cookTimeNote`: explains a range such as Low versus High.
- `servingsLabel`: changes “servings” to another label.
- `servingSuggestions`, `substitutions`, `equipment`, and `foodSafety`.
- `nutrition`: only use measured or professionally calculated values and include
  their `source`.
- `featured: true`: selects the homepage featured recipe.
- `popularRank`: lower numbers appear first in the homepage popular row.
- `related`: a list of other recipe filenames/slugs, for example
  `[slow-cooker-beef-stew]`.

## 3. Add the image

Store recipe images in:

```text
src/assets/recipes/
```

For a Markdown file in `src/content/recipes/`, reference the image with two
parent-directory segments:

```yaml
image: ../../assets/recipes/slow-cooker-chicken-tacos.jpg
```

JPG, PNG, WebP, and SVG are supported by Astro. Use a real image you own or
have permission to use, preferably at least 1600 pixels wide. Write
`imageAlt` as a useful description of the finished dish, not a filename.
Astro creates responsive image sizes automatically.

## 4. Review and publish

New recipes should start as:

```yaml
reviewStatus: draft
```

Drafts remain visible for preview, show a draft notice, receive `noindex`, and
are excluded from the sitemap. Before publishing, cook and verify the recipe,
replace any placeholder image, and change the value to:

```yaml
reviewStatus: tested
updatedDate: 2026-10-30
```

The recipe then becomes indexable and appears in the sitemap automatically.

## 5. Check and build

From the project root, run:

```powershell
npm run check
npm run build
```

Fix any schema error reported by Astro before publishing. To preview locally:

```powershell
npm run dev
```

Open the generated recipe URL, its category page, `/recipes/`, and `/search/`.
The production deployment process then publishes the new file through the
normal Git/Cloudflare Pages build.

## What is generated automatically?

The reusable route in `src/pages/recipe/[slug].astro` renders the shared
`RecipeDetail` layout. It uses the existing header, footer, colors, cards, and
styles. The same collection entry is automatically used by:

- `/recipes/` and its pagination;
- the matching `/category/<category>/` page;
- tag/category hubs such as `/category/slow-cooker/`;
- homepage featured, popular, and latest sections;
- client-side recipe search;
- canonical URL, Open Graph metadata, publication dates, and breadcrumbs;
- Recipe JSON-LD using the recipe's real ingredients, times, yield, author,
  dates, category, keywords, image, and instructions;
- the XML sitemap, when `reviewStatus` is `tested`.

## Is an admin dashboard useful?

Not yet for this static site. Markdown-in-Git keeps the workflow inexpensive,
reviewable, versioned, and compatible with the current Astro build. A browser
dashboard would require a Git-backed CMS (such as Decap CMS) or a hosted
headless CMS (such as Sanity, Contentful, or Storyblok), plus authentication,
content storage, image hosting, preview/build webhooks, and usually a
serverless function or OAuth provider.

That adds operational and security work: protect editor accounts with
multi-factor authentication, keep webhook tokens server-side, validate uploads,
limit editor permissions, and avoid exposing CMS management tokens in browser
code. Hosted CMS products may also charge for users, API requests, storage, or
image bandwidth. If non-technical editors become a real need, a Git-backed CMS
is the smallest next step; it should be evaluated separately rather than added
to this static site prematurely.
