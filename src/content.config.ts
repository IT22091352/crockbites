import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const ingredient = z.object({
  /** Numeric amount for the base serving count. Omit for "to taste" style items. */
  quantity: z.number().positive().optional(),
  /** Singular unit: cup, tbsp, tsp, lb, oz, clove, can, ... (pluralised automatically where needed). */
  unit: z.string().optional(),
  item: z.string(),
  /** Plural form for countable items without a unit (e.g. "large carrots"). */
  itemPlural: z.string().optional(),
  /** Short note shown after the item, e.g. "diced" or "optional". */
  note: z.string().optional(),
  /** Metric/alt amount for display, e.g. "(900 g)". Not scaled; keep it short and approximate. */
  alt: z.string().optional(),
  /** Optional heading to group ingredients, e.g. "For the rub". */
  group: z.string().optional(),
  /** Mark non-scaling items (e.g. "pinch of salt"). */
  scale: z.boolean().default(true),
});

const recipeImage = z.object({
  url: z.string(),
  publicId: z.string().optional(),
  alt: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  isPrimary: z.boolean().default(false),
});

const recipes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/recipes' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** URL slug. When omitted, the Markdown file name becomes the slug. */
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens only.').optional(),
      description: z.string().max(200),
      category: z.enum([
        'slow-cooker-chicken', 'beef-pork', 'soups-stews', 'easy-dinners',
        'breakfast', 'vegetarian', 'desserts-baking',
      ]),
      tags: z.array(z.string()).default([]),
      image: z.union([image(), z.string()]),
      imageAlt: z.string(),
      gallery: z.array(recipeImage).default([]),
      author: z.string().default('CrockBites'),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      prepMinutes: z.number().int().nonnegative(),
      cookMinutes: z.number().int().nonnegative(),
      /** Defaults to prep + cook. */
      totalMinutes: z.number().int().nonnegative().optional(),
      /** Plain-language cook time range shown beside the numbers. */
      cookTimeNote: z.string().optional(),
      servings: z.number().int().positive(),
      servingsLabel: z.string().default('servings'),
      ingredients: z.array(ingredient).min(1),
      instructions: z.array(z.object({ title: z.string().optional(), text: z.string() })).min(1),
      servingSuggestions: z.array(z.string()).default([]),
      tips: z.array(z.string()).default([]),
      substitutions: z.array(z.object({ ingredient: z.string(), swap: z.string() })).default([]),
      storage: z
        .object({ fridge: z.string().optional(), freezer: z.string().optional(), reheating: z.string().optional() })
        .default({}),
      equipment: z.array(z.string()).default([]),
      /** Safe internal temperatures that apply to this recipe. */
      foodSafety: z.array(z.string()).default([]),
      /** ONLY fill with real, measured or professionally calculated values. Leave out otherwise. */
      nutrition: z
        .object({
          calories: z.number().optional(),
          proteinGrams: z.number().optional(),
          carbsGrams: z.number().optional(),
          fatGrams: z.number().optional(),
          fiberGrams: z.number().optional(),
          sodiumMilligrams: z.number().optional(),
          source: z.string().optional(),
        })
        .optional(),
      featured: z.boolean().default(false),
      /** Editorial ordering for the homepage "Popular recipes" row (1 = first). Based on search demand in docs/content-roadmap.md, not on site traffic. */
      popularRank: z.number().int().positive().optional(),
      related: z.array(z.string()).default([]),
      /** `draft` = written but not yet cooked and checked by a person. */
      reviewStatus: z.enum(['draft', 'tested']).default('draft'),
    }),
});

export const collections = { recipes };
