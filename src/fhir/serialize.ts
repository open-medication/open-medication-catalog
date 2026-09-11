/** Deterministic JSON / NDJSON helpers. */

/**
 * FHIR `code` / token: at least one character, no leading/trailing whitespace,
 * and no whitespace other than single spaces.
 */
export function fhirCode(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Swissmedic quantities use a comma decimal (`1,5`). FHIR JSON numbers must be
 * IEEE decimals; `Number("1,5")` is NaN and would serialize as null.
 */
export function parseFhirDecimal(value: string | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function jsonLine(value: unknown): string {
  return `${stableJson(value)}\n`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) {
      if (rec[key] === undefined) continue;
      out[key] = sortValue(rec[key]);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  return value;
}
