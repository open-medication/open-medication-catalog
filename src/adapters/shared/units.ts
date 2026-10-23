/**
 * Split a ratio unit such as `mg/5 ml` into a numerator unit, a denominator
 * value, and a denominator unit, matching the FDA NDC convention
 * (`denominatorValue` carries the number, `denominatorUnit` the bare unit).
 */
export function splitRatioUnit(
  unit: string,
): { numeratorUnit: string; denominatorValue: string; denominatorUnit: string } | undefined {
  const match = unit.match(/^([^/]+)\/(\d+(?:\.\d+)?)?(.*)$/);
  if (!match) return undefined;
  const numeratorUnit = match[1]!.trim();
  if (!numeratorUnit) return undefined;
  const denominatorValue = match[2] && match[2].length > 0 ? match[2] : "1";
  const denominatorUnit = match[3]!.trim() || "1";
  return { numeratorUnit, denominatorValue, denominatorUnit };
}