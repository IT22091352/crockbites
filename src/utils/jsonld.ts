import { site } from '../config/site';
import { absoluteUrl, type Recipe, recipeUrl, totalMinutes } from './recipes';
import { ingredientToString } from './quantity';
import { isoDuration } from './time';

/** Serialise safely for embedding inside <script type="application/ld+json">. */
export const toJsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

export function organizationSchema() {
  return {
    '@type': 'Organization',
    '@id': `${site.url}/#organization`,
    name: site.name,
    url: site.url,
    logo: { '@type': 'ImageObject', url: absoluteUrl('/icon-512.png'), width: 512, height: 512 },
    ...(site.social.length ? { sameAs: site.social.map((s) => s.url) } : {}),
  };
}

export function websiteSchema() {
  return {
    '@type': 'WebSite',
    '@id': `${site.url}/#website`,
    url: site.url,
    name: site.name,
    description: site.description,
    inLanguage: site.language,
    publisher: { '@id': `${site.url}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${site.url}/search/?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function homeGraph() {
  return { '@context': 'https://schema.org', '@graph': [organizationSchema(), websiteSchema()] };
}

export function breadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it.name, item: absoluteUrl(it.url),
    })),
  };
}

export function recipeSchema(recipe: Recipe, imageUrl: string, categoryName: string) {
  const d = recipe.data;
  const n = d.nutrition;
  const nutrition = n && (n.calories || n.proteinGrams || n.carbsGrams || n.fatGrams)
    ? {
        nutrition: {
          '@type': 'NutritionInformation',
          servingSize: '1 serving',
          ...(n.calories != null ? { calories: `${n.calories} calories` } : {}),
          ...(n.proteinGrams != null ? { proteinContent: `${n.proteinGrams} g` } : {}),
          ...(n.carbsGrams != null ? { carbohydrateContent: `${n.carbsGrams} g` } : {}),
          ...(n.fatGrams != null ? { fatContent: `${n.fatGrams} g` } : {}),
          ...(n.fiberGrams != null ? { fiberContent: `${n.fiberGrams} g` } : {}),
          ...(n.sodiumMilligrams != null ? { sodiumContent: `${n.sodiumMilligrams} mg` } : {}),
        },
      }
    : {};
  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    '@id': `${absoluteUrl(recipeUrl(recipe))}#recipe`,
    name: d.title,
    description: d.description,
    image: [imageUrl],
    author: { '@type': 'Organization', name: d.author, url: site.url },
    datePublished: d.pubDate.toISOString().slice(0, 10),
    ...(d.updatedDate ? { dateModified: d.updatedDate.toISOString().slice(0, 10) } : {}),
    prepTime: isoDuration(d.prepMinutes),
    cookTime: isoDuration(d.cookMinutes),
    totalTime: isoDuration(totalMinutes(recipe)),
    recipeYield: [String(d.servings), `${d.servings} ${d.servingsLabel}`],
    recipeCategory: categoryName,
    keywords: d.tags.join(', '),
    recipeIngredient: d.ingredients.map(ingredientToString),
    recipeInstructions: d.instructions.map((s, i) => ({
      '@type': 'HowToStep',
      ...(s.title ? { name: s.title } : {}),
      text: s.text,
      url: `${absoluteUrl(recipeUrl(recipe))}#step-${i + 1}`,
    })),
    ...nutrition,
    // Intentionally no aggregateRating or review: CrockBites has no genuine ratings.
  };
}
