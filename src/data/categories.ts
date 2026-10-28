export type CategoryId =
  | 'slow-cooker-chicken'
  | 'beef-pork'
  | 'soups-stews'
  | 'easy-dinners'
  | 'breakfast'
  | 'vegetarian'
  | 'desserts-baking';

export interface Category {
  id: CategoryId;
  name: string;
  short: string;
  description: string;
  /** Key into the icon map in CategoryIcon.astro. */
  icon: 'drumstick' | 'beef' | 'soup' | 'utensils' | 'egg-fried' | 'leaf' | 'cake-slice';
}

export const categories: Category[] = [
  { id: 'slow-cooker-chicken', name: 'Slow Cooker Chicken', short: 'Chicken', icon: 'drumstick',
    description: 'Tender slow cooker chicken recipes, from lemon-garlic thighs to creamy gravy served over mash.' },
  { id: 'beef-pork', name: 'Beef & Pork', short: 'Beef & Pork', icon: 'beef',
    description: 'Pulled pork and other slow-cooked cuts that turn tender while you get on with your day.' },
  { id: 'soups-stews', name: 'Soups & Stews', short: 'Soups & Stews', icon: 'soup',
    description: 'Hearty slow cooker soups and stews for cold evenings and make-ahead lunches.' },
  { id: 'easy-dinners', name: 'Easy Dinners', short: 'Easy Dinners', icon: 'utensils',
    description: 'Low-effort weeknight dinners that mostly cook themselves.' },
  { id: 'breakfast', name: 'Breakfast', short: 'Breakfast', icon: 'egg-fried',
    description: 'Make-ahead breakfasts and brunch dishes you can cook in the slow cooker.' },
  { id: 'vegetarian', name: 'Vegetarian', short: 'Vegetarian', icon: 'leaf',
    description: 'Meat-free slow cooker meals packed with vegetables, beans and grains.' },
  { id: 'desserts-baking', name: 'Desserts & Baking', short: 'Desserts', icon: 'cake-slice',
    description: 'Slow cooker desserts and simple bakes.' },
];

export const categoryById = (id: string) => categories.find((c) => c.id === id);

/**
 * Hubs are curated collections shown in the main navigation. They reuse the
 * /category/<slug>/ route but gather recipes by tag or across several categories.
 */
export interface Hub {
  slug: string;
  name: string;
  description: string;
  tag?: string;
  categories?: CategoryId[];
}

export const hubs: Hub[] = [
  { slug: 'slow-cooker', name: 'Slow Cooker', tag: 'slow cooker',
    description: 'Every CrockBites recipe built around the slow cooker (crockpot): set it, leave it, come back to dinner.' },
  { slug: 'dinner-ideas', name: 'Dinner Ideas',
    categories: ['slow-cooker-chicken', 'beef-pork', 'soups-stews', 'easy-dinners', 'vegetarian'],
    description: 'Dinner ideas for busy evenings: chicken, beef, pork, soups, stews and vegetarian mains.' },
];
