/** Deterministic JSON / NDJSON helpers. */

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function jsonLine(value: unknown): string {
  return `${stableJson(value)}\n`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) {
      if (rec[key] === undefined) continue;
      out[key] = sortValue(rec[key]);
    }
    return out;
  }
  return value;
}
