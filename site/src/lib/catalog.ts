import catalogJson from "../../public/catalog.json" with { type: "json" };
import { GITHUB_REPO } from "./site.ts";

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
  sources: string;
  blurb: string;
  redistribution: string;
}

/** Official recipes we always show, even before a public zip exists. */
export const ARTIFACT_META: ArtifactMeta[] = [
  {
    id: "ch-base",
    title: "Switzerland: base",
    jurisdiction: "CH",
    sources: "Swissmedic OGD",
    blurb: "Swissmedic medicinal-product export.",
    redistribution: "Swissmedic open terms. Licence and attribution are in the zip.",
  },
  {
    id: "ch-enriched",
    title: "Switzerland: enriched",
    jurisdiction: "CH",
    sources: "Swissmedic OGD + Refdata",
    blurb: "Swissmedic export plus GTIN and trade status from Refdata. The Refdata ZIP is not included.",
    redistribution: "Derived Refdata fields only. Attribution may be required.",
  },
];

export function loadCatalog(): CatalogDoc {
  return catalogJson as CatalogDoc;
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
