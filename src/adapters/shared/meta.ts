/** Drop blank metadata fields so canonical JSON stays compact. */
export function compactMeta(values: Record<string, string | undefined>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const trimmed = value?.trim();
    if (trimmed) out[key] = trimmed;
  }
  return Object.keys(out).length ? out : undefined;
}
