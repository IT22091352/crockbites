import { formatQuantity, unitLabel } from './quantity.ts';

export type UnitSystem = 'us' | 'metric';

export interface ConvertedIngredient {
  quantity: number | undefined;
  unit: string | undefined;
  amountText: string;
  isConverted: boolean;
}

// Canonical unit normalization
const VOLUME_UNITS = new Set([
  'cup', 'cups',
  'tbsp', 'tablespoon', 'tablespoons',
  'tsp', 'teaspoon', 'teaspoons',
  'fl oz', 'fluid ounce', 'fluid ounces',
  'ml', 'milliliter', 'milliliters',
  'l', 'liter', 'liters',
]);

const WEIGHT_UNITS = new Set([
  'lb', 'lbs', 'pound', 'pounds',
  'oz', 'ounce', 'ounces',
  'g', 'gram', 'grams',
  'kg', 'kilogram', 'kilograms',
]);

function normalizeUnit(unit: string | undefined): string {
  if (!unit) return '';
  return unit.toLowerCase().trim().replace(/\.$/, '');
}

/**
 * Converts a quantity from one unit system to another.
 * Distinguishes volume and weight strictly to avoid density assumptions.
 * Non-convertible units (cloves, cans, slices, pinches, etc.) are kept unchanged.
 */
export function convertUnitQuantity(
  qty: number,
  rawUnit: string | undefined,
  targetSystem: UnitSystem,
): { quantity: number; unit: string; isConverted: boolean } {
  if (!isFinite(qty) || qty <= 0 || !rawUnit) {
    return { quantity: qty, unit: rawUnit || '', isConverted: false };
  }

  const u = normalizeUnit(rawUnit);

  // --- Volume conversions ---
  if (VOLUME_UNITS.has(u)) {
    if (targetSystem === 'metric') {
      // US Volume -> Metric (ml or L)
      let ml = 0;
      if (u === 'cup' || u === 'cups') ml = qty * 240;
      else if (u === 'tbsp' || u === 'tablespoon' || u === 'tablespoons') ml = qty * 15;
      else if (u === 'tsp' || u === 'teaspoon' || u === 'teaspoons') ml = qty * 5;
      else if (u === 'fl oz' || u === 'fluid ounce' || u === 'fluid ounces') ml = qty * 30;
      else if (u === 'ml' || u === 'milliliter' || u === 'milliliters') ml = qty;
      else if (u === 'l' || u === 'liter' || u === 'liters') ml = qty * 1000;

      if (ml >= 1000) {
        const liters = Math.round((ml / 1000) * 10) / 10;
        return { quantity: liters, unit: 'L', isConverted: true };
      }
      if (ml < 5) {
        return { quantity: Math.round(ml * 10) / 10, unit: 'ml', isConverted: true };
      }
      const roundedMl = ml >= 50 ? Math.round(ml / 10) * 10 : Math.round(ml / 5) * 5;
      return { quantity: roundedMl || 5, unit: 'ml', isConverted: true };
    }

    if (targetSystem === 'us') {
      // Metric Volume -> US (cups, tbsp, tsp)
      let ml = 0;
      if (u === 'ml' || u === 'milliliter' || u === 'milliliters') ml = qty;
      else if (u === 'l' || u === 'liter' || u === 'liters') ml = qty * 1000;
      else {
        // Already US volume
        return { quantity: qty, unit: rawUnit, isConverted: false };
      }

      if (ml >= 120) {
        const cups = ml / 240;
        return { quantity: cups, unit: 'cup', isConverted: true };
      }
      if (ml >= 15) {
        const tbsp = ml / 15;
        return { quantity: tbsp, unit: 'tbsp', isConverted: true };
      }
      const tsp = ml / 5;
      return { quantity: tsp, unit: 'tsp', isConverted: true };
    }
  }

  // --- Weight conversions ---
  if (WEIGHT_UNITS.has(u)) {
    if (targetSystem === 'metric') {
      // US Weight -> Metric (g or kg)
      let grams = 0;
      if (u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds') grams = qty * 453.592;
      else if (u === 'oz' || u === 'ounce' || u === 'ounces') grams = qty * 28.3495;
      else if (u === 'g' || u === 'gram' || u === 'grams') grams = qty;
      else if (u === 'kg' || u === 'kilogram' || u === 'kilograms') grams = qty * 1000;

      if (grams >= 1000) {
        const kg = Math.round((grams / 1000) * 10) / 10;
        return { quantity: kg, unit: 'kg', isConverted: true };
      }
      const roundedGrams = grams >= 50 ? Math.round(grams / 5) * 5 : Math.round(grams);
      return { quantity: roundedGrams, unit: 'g', isConverted: true };
    }

    if (targetSystem === 'us') {
      // Metric Weight -> US (lb or oz)
      let grams = 0;
      if (u === 'g' || u === 'gram' || u === 'grams') grams = qty;
      else if (u === 'kg' || u === 'kilogram' || u === 'kilograms') grams = qty * 1000;
      else {
        // Already US weight
        return { quantity: qty, unit: rawUnit, isConverted: false };
      }

      if (grams >= 400) {
        const lbs = grams / 453.592;
        return { quantity: lbs, unit: 'lb', isConverted: true };
      }
      const oz = grams / 28.3495;
      return { quantity: oz, unit: 'oz', isConverted: true };
    }
  }

  // Countable, non-convertible, or ambiguous units (cloves, pinches, cans, etc.)
  return { quantity: qty, unit: rawUnit, isConverted: false };
}

/**
 * Combines serving scaling and unit conversion seamlessly.
 */
export function formatScaledAndConvertedAmount(
  baseQuantity: number | undefined,
  baseUnit: string | undefined,
  servingFactor: number,
  targetSystem: UnitSystem,
  isScalable = true,
): ConvertedIngredient {
  if (baseQuantity == null || !isFinite(baseQuantity) || baseQuantity <= 0) {
    return {
      quantity: undefined,
      unit: baseUnit,
      amountText: '',
      isConverted: false,
    };
  }

  const factor = isScalable ? servingFactor : 1;
  const scaledQty = baseQuantity * factor;

  const { quantity, unit, isConverted } = convertUnitQuantity(scaledQty, baseUnit, targetSystem);

  let formatted = '';
  if (targetSystem === 'metric' && (unit === 'g' || unit === 'ml')) {
    formatted = `${Math.round(quantity)} ${unit}`;
  } else if (targetSystem === 'metric' && (unit === 'kg' || unit === 'L')) {
    formatted = `${quantity} ${unit}`;
  } else {
    const qStr = formatQuantity(quantity);
    const uStr = unitLabel(unit, quantity);
    formatted = uStr ? `${qStr} ${uStr}` : qStr;
  }

  return {
    quantity,
    unit,
    amountText: formatted,
    isConverted,
  };
}
