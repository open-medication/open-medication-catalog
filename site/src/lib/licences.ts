import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type LicenceTag = "allowed" | "disallowed" | "review-required";

export interface SourceLicence {
  sourceId: string;
  label: string;
  commercialUse: LicenceTag;
  redistribution: LicenceTag;
  attributionRequired: boolean;
  termsUrl: string;
  datasetUrl?: string;
  fragment?: string;
  reviewedAt: string;
  notes?: string;
  redistributeRaw?: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  swissmedic: "Swissmedic OGD",
  refdata: "Refdata",
  bag: "BAG Spezialitätenliste",
};

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "adapters", "ch", "swissmedic", "source.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repository root (adapters/ch/swissmedic/source.yaml)");
}

function parseSourceYaml(file: string): SourceLicence {
  const raw = YAML.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  const terms = raw.terms as Record<string, unknown> | undefined;
  const policy = raw.releasePolicy as Record<string, unknown> | undefined;
  const sourceId = String(raw.sourceId ?? "");
  if (!terms?.url || !sourceId) {
    throw new Error(`Invalid source.yaml: ${file}`);
  }
  return {
    sourceId,
    label: SOURCE_LABELS[sourceId] ?? String(raw.authority ?? sourceId),
    commercialUse: raw.commercialUse as LicenceTag,
    redistribution: raw.redistribution as LicenceTag,
    attributionRequired: Boolean(raw.attributionRequired),
    termsUrl: String(terms.url),
    datasetUrl: typeof terms.datasetUrl === "string" ? terms.datasetUrl : undefined,
    fragment: typeof terms.fragment === "string" ? terms.fragment : undefined,
    reviewedAt: String(terms.reviewedAt ?? ""),
    notes: typeof terms.notes === "string" ? terms.notes : undefined,
    redistributeRaw: typeof policy?.redistributeRaw === "boolean" ? policy.redistributeRaw : undefined,
  };
}

export function allSourceLicences(): SourceLicence[] {
  const adapters = path.join(repoRoot(), "adapters");
  const out: SourceLicence[] = [];
  for (const jurisdiction of fs.readdirSync(adapters).sort()) {
    const jurDir = path.join(adapters, jurisdiction);
    if (!fs.statSync(jurDir).isDirectory()) continue;
    for (const source of fs.readdirSync(jurDir).sort()) {
      const file = path.join(jurDir, source, "source.yaml");
      if (fs.existsSync(file)) out.push(parseSourceYaml(file));
    }
  }
  const order = ["swissmedic", "refdata", "bag"];
  out.sort((a, b) => {
    const ai = order.indexOf(a.sourceId);
    const bi = order.indexOf(b.sourceId);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.sourceId.localeCompare(b.sourceId);
  });
  return out;
}

export function sourceLicence(sourceId: string): SourceLicence {
  const found = allSourceLicences().find((s) => s.sourceId === sourceId);
  if (!found) throw new Error(`No source.yaml for ${sourceId}`);
  return found;
}

export function sourcesForArtifact(artifactId: string): SourceLicence[] {
  const parsed = YAML.parse(fs.readFileSync(path.join(repoRoot(), "artifacts.yaml"), "utf8")) as {
    artifacts?: Record<string, { requiredSources?: string[] }>;
  };
  const ids = parsed.artifacts?.[artifactId]?.requiredSources ?? [];
  return ids.map((id) => sourceLicence(id));
}

export function attributionLabel(required: boolean): string {
  return required ? "true" : "false";
}
