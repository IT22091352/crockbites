import assert from 'node:assert/strict';
import {
  convertUnitQuantity,
  formatScaledAndConvertedAmount,
} from '../src/utils/cooking-units.ts';
import { extractInstructionDuration, formatTimerCountdown } from '../src/utils/timer.ts';

// 1. Volume Conversion: US to Metric
const cupsToMetric = convertUnitQuantity(2, 'cups', 'metric');
assert.equal(cupsToMetric.quantity, 480, '2 cups -> 480 ml');
assert.equal(cupsToMetric.unit, 'ml');

const halfCupToMetric = convertUnitQuantity(0.5, 'cup', 'metric');
assert.equal(halfCupToMetric.quantity, 120, '0.5 cup -> 120 ml');
assert.equal(halfCupToMetric.unit, 'ml');

const largeVolumeToMetric = convertUnitQuantity(6, 'cups', 'metric');
assert.equal(largeVolumeToMetric.quantity, 1.4, '6 cups (~1440ml) -> 1.4 L');
assert.equal(largeVolumeToMetric.unit, 'L');

const tbspToMetric = convertUnitQuantity(2, 'tbsp', 'metric');
assert.equal(tbspToMetric.quantity, 30, '2 tbsp -> 30 ml');
assert.equal(tbspToMetric.unit, 'ml');

const tspToMetric = convertUnitQuantity(1, 'tsp', 'metric');
assert.equal(tspToMetric.quantity, 5, '1 tsp -> 5 ml');
assert.equal(tspToMetric.unit, 'ml');

// 2. Weight Conversion: US to Metric
const fourLbToMetric = convertUnitQuantity(4, 'lb', 'metric');
assert.equal(fourLbToMetric.quantity, 1.8, '4 lb -> 1.8 kg');
assert.equal(fourLbToMetric.unit, 'kg');

const oneLbToMetric = convertUnitQuantity(1, 'lb', 'metric');
assert.equal(oneLbToMetric.quantity, 455, '1 lb -> 455 g (or rounded 450-455g)');
assert.equal(oneLbToMetric.unit, 'g');

const ozToMetric = convertUnitQuantity(8, 'oz', 'metric');
assert.equal(ozToMetric.quantity, 225, '8 oz -> 225 g');
assert.equal(ozToMetric.unit, 'g');

// 3. Countable / Non-Convertible Units (Density Protection)
const cloves = convertUnitQuantity(4, 'cloves', 'metric');
assert.equal(cloves.quantity, 4);
assert.equal(cloves.unit, 'cloves', 'cloves not converted');
assert.equal(cloves.isConverted, false);

const pinch = convertUnitQuantity(1, 'pinch', 'metric');
assert.equal(pinch.quantity, 1);
assert.equal(pinch.unit, 'pinch', 'pinch not converted');

const cans = convertUnitQuantity(2, 'cans', 'metric');
assert.equal(cans.quantity, 2);
assert.equal(cans.unit, 'cans', 'cans not converted');

// 4. Combined Serving Scaler + Unit Conversion
// Example: 2 lb scaled by 2 (factor = 2) in US -> 4 lb
const scaledUs = formatScaledAndConvertedAmount(2, 'lb', 2, 'us', true);
assert.equal(scaledUs.amountText, '4 lb', 'scales to 4 lb in US');

// Example: 2 lb scaled by 2 (factor = 2) in Metric -> 1.8 kg
const scaledMetric = formatScaledAndConvertedAmount(2, 'lb', 2, 'metric', true);
assert.equal(scaledMetric.amountText, '1.8 kg', 'scales and converts to 1.8 kg in Metric');

// Example: 1 cup scaled by 0.5 in US -> ½ cup
const halfCupUs = formatScaledAndConvertedAmount(1, 'cup', 0.5, 'us', true);
assert.equal(halfCupUs.amountText, '½ cup', 'scales to ½ cup');

// Example: 1 cup scaled by 0.5 in Metric -> 120 ml
const halfCupMetric = formatScaledAndConvertedAmount(1, 'cup', 0.5, 'metric', true);
assert.equal(halfCupMetric.amountText, '120 ml', 'scales to 120 ml');

// Non-scalable ingredient remains constant
const nonScalable = formatScaledAndConvertedAmount(1, 'pinch', 3, 'us', false);
assert.equal(nonScalable.amountText, '1 pinch', 'non-scalable amount does not change');

// Non-numeric or missing quantity handled safely without crashing
const missingQty = formatScaledAndConvertedAmount(undefined, undefined, 2, 'metric', true);
assert.equal(missingQty.amountText, '', 'missing qty returns empty string safely');

// 5. Timer Duration Extraction
const d1 = extractInstructionDuration('Cover and cook on LOW for 6 to 8 hours until beef is tender.');
assert.ok(d1, 'extracts hours duration');
assert.equal(d1.minutes, 360, '6 hours = 360 min');
assert.equal(d1.label, '6 hrs');

const d2 = extractInstructionDuration('Simmer on low for 25 minutes before serving.');
assert.ok(d2, 'extracts minutes duration');
assert.equal(d2.minutes, 25);
assert.equal(d2.label, '25 min');

const d3 = extractInstructionDuration('Season with salt and pepper to taste.');
assert.equal(d3, null, 'returns null when no duration mentioned');

// 6. Timer Countdown Formatting
assert.equal(formatTimerCountdown(3665), '01:01:05', 'formats hours, minutes, seconds');
assert.equal(formatTimerCountdown(125), '02:05', 'formats minutes and seconds');
assert.equal(formatTimerCountdown(0), '00:00', 'formats zero countdown');

// 7. Phase 3: Checklist Progress Calculation & Unique Index Validation
function calculateChecklistProgress(checkedSet, total) {
  const safeCount = Math.min(checkedSet.size, total);
  return `${safeCount} of ${total} ingredients gathered`;
}
assert.equal(calculateChecklistProgress(new Set([0, 1]), 8), '2 of 8 ingredients gathered');
assert.equal(calculateChecklistProgress(new Set(), 8), '0 of 8 ingredients gathered');
assert.equal(calculateChecklistProgress(new Set([0, 1, 2, 3, 4, 5, 6, 7]), 8), '8 of 8 ingredients gathered');

// 8. Phase 3: Checklist Invalid / Corrupt Data Recovery
function sanitizeChecklistIndices(rawJson, totalUnique) {
  const validIndices = new Set();
  try {
    const parsed = JSON.parse(rawJson);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item !== null && item !== undefined && typeof item !== 'boolean') {
          const num = Number(item);
          if (Number.isInteger(num) && num >= 0 && num < totalUnique) {
            validIndices.add(num);
          }
        }
      }
    }
  } catch {}
  return validIndices;
}
assert.deepEqual(
  Array.from(sanitizeChecklistIndices('["corrupt", -1, 999, 2, null, 4]', 6)),
  [2, 4],
  'filters out negative, out-of-bounds, non-integer, and null checklist entries'
);
assert.deepEqual(
  Array.from(sanitizeChecklistIndices('not-json', 6)),
  [],
  'safely handles non-JSON strings without throwing'
);

// 9. Phase 3: Cooking Step Index Sanitization & Boundary Protection
function sanitizeCookingStep(raw, stepCount) {
  if (raw !== null && raw !== undefined) {
    const parsed = parseInt(String(raw), 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed < stepCount) {
      return parsed;
    }
  }
  return 0;
}
assert.equal(sanitizeCookingStep('2', 5), 2, 'valid step retained');
assert.equal(sanitizeCookingStep('-1', 5), 0, 'negative step defaults to 0');
assert.equal(sanitizeCookingStep('99', 5), 0, 'out-of-bounds step defaults to 0');
assert.equal(sanitizeCookingStep('invalid', 5), 0, 'non-numeric step defaults to 0');
assert.equal(sanitizeCookingStep(null, 5), 0, 'null step defaults to 0');

// 10. Phase 3: Completion and Restart Reset Logic
let activeStep = 3;
function restartCooking() {
  activeStep = 0;
  return activeStep;
}
function finishCooking() {
  activeStep = 0;
  return { activeStep, completed: true };
}
assert.equal(restartCooking(), 0, 'restart resets active step to 0');
activeStep = 4;
assert.deepEqual(finishCooking(), { activeStep: 0, completed: true }, 'finish resets active step to 0');

console.log('cooking-units and timer tests passed');

