import { site } from '../config/site.ts';
import { absoluteUrl, type Recipe, recipeUrl, totalMinutes } from './recipes.ts';
import { ingredientToString } from './quantity.ts';
import { isoDuration } from './time.ts';

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

export interface RecipeReviewStatsInput {
  ratingValue: number;
  reviewCount: number;
}

/** Determines editorially supported cuisine without guessing or fabricating data. */
function getEditoriallySupportedCuisine(slug: string, tags: string[] = []): string | undefined {
  const normalizedSlug = slug.toLowerCase();
  const lowerTags = tags.map((t) => t.toLowerCase());

  if (normalizedSlug.includes('sri-lankan') || lowerTags.includes('sri lankan')) {
    return 'Sri Lankan';
  }
  if (normalizedSlug.includes('tuscan') || normalizedSlug.includes('minestrone') || lowerTags.includes('italian')) {
    return 'Italian';
  }
  if (
    normalizedSlug === 'slow-cooker-beef-chili' ||
    normalizedSlug === 'bbq-slow-cook-ribs-recipe-for-the-crock-pot' ||
    normalizedSlug === 'brown-sugar-crockpot-ham' ||
    normalizedSlug.includes('chicken') ||
    normalizedSlug.includes('pork') ||
    normalizedSlug.includes('beef-stew') ||
    normalizedSlug.includes('turkey') ||
    lowerTags.includes('american')
  ) {
    return 'American';
  }

  return undefined;
}

export function recipeSchema(
  recipe: Recipe,
  imageUrl: string,
  categoryName: string,
  reviews?: RecipeReviewStatsInput | null,
  cuisineOverride?: string
) {
  const d = recipe.data;
  const slug = (d.slug ?? (recipe as any).slug ?? recipe.id ?? '').replace(/\.md$/, '');
  const pubDate = d.pubDate instanceof Date ? d.pubDate : new Date(d.pubDate || Date.now());
  const updatedDate = d.updatedDate ? (d.updatedDate instanceof Date ? d.updatedDate : new Date(d.updatedDate)) : undefined;
  const safePubDate = isNaN(pubDate.getTime()) ? new Date() : pubDate;
  const safeUpdatedDate = updatedDate && !isNaN(updatedDate.getTime()) ? updatedDate : undefined;

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
          ...(n.saturatedFatGrams != null ? { saturatedFatContent: `${n.saturatedFatGrams} g` } : {}),
          ...(n.unsaturatedFatGrams != null ? { unsaturatedFatContent: `${n.unsaturatedFatGrams} g` } : {}),
          ...(n.fiberGrams != null ? { fiberContent: `${n.fiberGrams} g` } : {}),
          ...(n.sugarGrams != null ? { sugarContent: `${n.sugarGrams} g` } : {}),
          ...(n.sodiumMilligrams != null ? { sodiumContent: `${n.sodiumMilligrams} mg` } : {}),
          ...(n.cholesterolMilligrams != null ? { cholesterolContent: `${n.cholesterolMilligrams} mg` } : {}),
        },
      }
    : {};

  // AggregateRating: Strictly omit unless genuine published reviews exist (reviewCount > 0)
  const aggregateRating = reviews && reviews.reviewCount > 0 && reviews.ratingValue > 0
    ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: Number(reviews.ratingValue.toFixed(1)),
          reviewCount: reviews.reviewCount,
          bestRating: 5,
          worstRating: 1,
        },
      }
    : {};

  // RecipeCuisine: Include only when editorially supported
  const cuisine = cuisineOverride || (d as any).recipeCuisine || (d as any).cuisine || getEditoriallySupportedCuisine(slug, d.tags);
  const cuisineProp = cuisine ? { recipeCuisine: cuisine } : {};

  // CookTime: Only emit when recipe actually requires cooking (omit for raw dishes like Pol Sambol)
  const cookTimeProp = d.cookMinutes > 0 ? { cookTime: isoDuration(d.cookMinutes) } : {};

  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    '@id': `${absoluteUrl(recipeUrl(recipe))}#recipe`,
    name: d.title,
    description: d.description,
    image: [imageUrl],
    author: { '@type': 'Organization', name: d.author, url: site.url },
    datePublished: safePubDate.toISOString().slice(0, 10),
    ...(safeUpdatedDate ? { dateModified: safeUpdatedDate.toISOString().slice(0, 10) } : {}),
    prepTime: isoDuration(d.prepMinutes),
    ...cookTimeProp,
    totalTime: isoDuration(totalMinutes(recipe)),
    recipeYield: [String(d.servings), `${d.servings} ${d.servingsLabel}`],
    recipeCategory: categoryName,
    ...cuisineProp,
    keywords: Array.isArray(d.tags) ? d.tags.join(', ') : '',
    recipeIngredient: Array.isArray(d.ingredients) ? d.ingredients.map(ingredientToString) : [],
    recipeInstructions: Array.isArray(d.instructions) ? d.instructions.map((s, i) => {
      const step: Record<string, unknown> = {
        '@type': 'HowToStep',
        ...(s.title ? { name: s.title } : {}),
        text: s.text,
        url: `${absoluteUrl(recipeUrl(recipe))}#step-${i + 1}`,
      };
      if ((s as any).image) {
        step.image = (s as any).image;
      }
      return step;
    }) : [],
    ...nutrition,
    ...aggregateRating,
  };
}
