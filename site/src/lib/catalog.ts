import { CATALOG_PATH, GITHUB_REPO } from "./site.ts";

export interface CatalogArtifact {
  latest: string;
  tag: string;
  url: string;
  zip?: string;
  manifest: string;
}

export interface CatalogDoc {
  artifacts: Record<string, CatalogArtifact>;
}

export interface ArtifactMeta {
  id: string;
  title: string;
  jurisdiction: string;
  blurb: string;
}

/** Official recipes we always show, even before a public zip exists. */
export const ARTIFACT_META: ArtifactMeta[] = [
  {
    id: "ch-base",
    title: "Switzerland: base",
    jurisdiction: "CH",
    blurb: "Swissmedic medicinal-product export.",
  },
  {
    id: "ch-enriched",
    title: "Switzerland: enriched",
    jurisdiction: "CH",
    blurb: "Swissmedic export plus GTIN, trade status, and pack names from Refdata.",
  },
  {
    id: "fr-base",
    title: "France: base",
    jurisdiction: "FR",
    blurb: "BDPM specialties, presentations, composition, and reimbursement rates.",
  },
];

export function parseCatalogDoc(data: unknown): CatalogDoc {
  if (!data || typeof data !== "object" || !("artifacts" in data)) {
    throw new Error("catalog.json is missing an artifacts object");
  }
  const artifacts = (data as { artifacts: unknown }).artifacts;
  if (!artifacts || typeof artifacts !== "object") {
    throw new Error("catalog.json artifacts must be an object");
  }
  return { artifacts: artifacts as Record<string, CatalogArtifact> };
}

export async function fetchCatalog(url: string = CATALOG_PATH): Promise<CatalogDoc> {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`catalog.json HTTP ${res.status}`);
  return parseCatalogDoc(await res.json());
}

export function zipUrl(entry: CatalogArtifact): string {
  if (entry.zip) return entry.zip;
  return `https://github.com/${GITHUB_REPO}/releases/download/${entry.tag}/${entry.tag}.zip`;
}

export function formatDataMonth(label: string): string {
  const m = label.match(/^(\d{4})\.(\d{2})$/);
  if (!m) return label;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return date.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
