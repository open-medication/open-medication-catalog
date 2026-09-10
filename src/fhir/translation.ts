import type { LocalizedName, Package } from "../canonical/types.js";

export const FHIR_TRANSLATION_URL = "http://hl7.org/fhir/StructureDefinition/translation";

const NAME_LANG_ORDER = ["de", "fr", "it", "en"] as const;

export function primaryLocalizedName(names: LocalizedName[] | undefined): LocalizedName | undefined {
  if (!names?.length) return undefined;
  for (const lang of NAME_LANG_ORDER) {
    const hit = names.find((n) => n.language === lang && n.text);
    if (hit) return hit;
  }
  return names.find((n) => n.text);
}

/** HL7 translation extensions for every name that is not the primary string. */
export function translationExtensions(
  names: LocalizedName[] | undefined,
  primaryText: string,
): Record<string, unknown>[] | undefined {
  if (!names?.length) return undefined;
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const n of names) {
    if (!n.text || !n.language || n.text === primaryText) continue;
    const key = `${n.language}|${n.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      url: FHIR_TRANSLATION_URL,
      extension: [
        { url: "lang", valueCode: n.language },
        { url: "content", valueString: n.text },
      ],
    });
  }
  return out.length ? out : undefined;
}

export function packageDisplayName(pkg: Package, fallback: string): string {
  return primaryLocalizedName(pkg.names)?.text ?? fallback;
}
