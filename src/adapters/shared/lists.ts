/** Split on a delimiter and trim empty parts. */
export function splitDelimitedList(value: string | undefined, delimiter: string | RegExp = ";"): string[] {
  if (!value) return [];
  return value
    .split(delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Split on commas that are outside parentheses, so a strain name stays one token. */
export function splitParentheticalCommaList(value: string | undefined): string[] {
  const text = value?.trim() ?? "";
  if (!text) return [];
  const parts: string[] = [];
  let token = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth += 1;
    else if (ch === ")" && depth > 0) depth -= 1;
    if (ch === "," && depth === 0) {
      if (token.trim()) parts.push(token.trim());
      token = "";
    } else {
      token += ch;
    }
  }
  if (token.trim()) parts.push(token.trim());
  return parts;
}
