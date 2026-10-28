/** Ingredient quantity helpers. Shared by the build (static HTML) and the browser (serving scaler). */

const FRACTIONS: [number, string][] = [
  [0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, ''],
];

/** 1.5 -> "1 ½", 0.33 -> "⅓", 2.07 -> "2". Falls back to one decimal if no fraction is close. */
export function formatQuantity(q: number): string {
  if (!isFinite(q) || q <= 0) return '';
  const whole = Math.floor(q);
  const frac = q - whole;
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(f[0] - frac) < Math.abs(best[0] - frac)) best = f;
  if (Math.abs(best[0] - frac) > 0.045) return String(Math.round(q * 10) / 10);
  if (best[0] === 1) return String(whole + 1);
  if (!best[1]) return String(whole || '');
  return whole ? `${whole} ${best[1]}` : best[1];
}

const PLURAL_UNITS: Record<string, string> = {
  cup: 'cups', can: 'cans', clove: 'cloves', slice: 'slices', rib: 'ribs', stalk: 'stalks', sprig: 'sprigs',
  bunch: 'bunches', pinch: 'pinches', package: 'packages', bag: 'bags', head: 'heads', stick: 'sticks',
};

export function unitLabel(unit: string | undefined, qty: number): string {
  if (!unit) return '';
  return qty > 1 && PLURAL_UNITS[unit] ? PLURAL_UNITS[unit] : unit;
}

export interface IngredientLike {
  quantity?: number;
  unit?: string;
  item: string;
  itemPlural?: string;
  note?: string;
  alt?: string;
  scale?: boolean;
}

/** The amount + unit part ("1 ½ cups"). Empty string for "to taste" items. */
export function amountText(i: IngredientLike, factor = 1): string {
  if (!i.quantity) return '';
  const q = i.scale === false ? i.quantity : i.quantity * factor;
  const n = formatQuantity(q);
  const u = unitLabel(i.unit, q);
  return u ? `${n} ${u}` : n;
}

export function itemText(i: IngredientLike, factor = 1): string {
  if (!i.quantity || i.unit) return i.item;
  const q = i.scale === false ? i.quantity : i.quantity * factor;
  return q > 1 && i.itemPlural ? i.itemPlural : i.item;
}

/** Plain-text ingredient line used for structured data. */
export function ingredientToString(i: IngredientLike): string {
  const parts = [amountText(i), i.alt, itemText(i)].filter(Boolean).join(' ');
  return i.note ? `${parts}, ${i.note}` : parts;
}
