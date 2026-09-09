import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { repoPath } from "../paths.js";
import type { AdapterMetadata } from "./types.js";

export type LicenceTag = "allowed" | "disallowed" | "review-required";

export interface SourceTerms {
  url: string;
  datasetUrl?: string;
  fragment?: string;
  reviewedAt: string;
  checksum?: string;
  notes?: string;
}

export interface SourceDescriptor {
  dir: string;
  sourceId: string;
  identityAuthority: string;
  authority?: string;
  dataset?: string;
  jurisdiction: string;
  updateFrequency: string;
  commercialUse: LicenceTag;
  redistribution: LicenceTag;
  attributionRequired: boolean;
  credentialsRequired: boolean;
  terms: SourceTerms;
  releasePolicy?: {
    public?: boolean;
    required?: boolean;
    redistributeRaw?: boolean;
  };
}

const TAGS = new Set<LicenceTag>(["allowed", "disallowed", "review-required"]);

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`source.yaml ${field} must be a non-empty string`);
  }
  return value;
}

function asTag(value: unknown, field: string): LicenceTag {
  if (typeof value !== "string" || !TAGS.has(value as LicenceTag)) {
    throw new Error(`source.yaml ${field} must be allowed | disallowed | review-required`);
  }
  return value as LicenceTag;
}

function asBool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`source.yaml ${field} must be a boolean`);
  }
  return value;
}

export function loadSourceDescriptor(dir: string): SourceDescriptor {
  const file = path.join(dir, "source.yaml");
  const raw = YAML.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  const termsRaw = raw.terms;
  if (!termsRaw || typeof termsRaw !== "object") {
    throw new Error(`source.yaml in ${dir} is missing terms`);
  }
  const terms = termsRaw as Record<string, unknown>;
  const policyRaw = raw.releasePolicy;
  const policy = policyRaw && typeof policyRaw === "object" ? (policyRaw as Record<string, unknown>) : undefined;
  return {
    dir,
    sourceId: asString(raw.sourceId, "sourceId"),
    identityAuthority: asString(raw.identityAuthority, "identityAuthority"),
    authority: typeof raw.authority === "string" ? raw.authority : undefined,
    dataset: typeof raw.dataset === "string" ? raw.dataset : undefined,
    jurisdiction: asString(raw.jurisdiction, "jurisdiction"),
    updateFrequency: asString(raw.updateFrequency, "updateFrequency"),
    commercialUse: asTag(raw.commercialUse, "commercialUse"),
    redistribution: asTag(raw.redistribution, "redistribution"),
    attributionRequired: asBool(raw.attributionRequired, "attributionRequired"),
    credentialsRequired: asBool(raw.credentialsRequired, "credentialsRequired"),
    terms: {
      url: asString(terms.url, "terms.url"),
      datasetUrl: typeof terms.datasetUrl === "string" ? terms.datasetUrl : undefined,
      fragment: typeof terms.fragment === "string" ? terms.fragment : undefined,
      reviewedAt: asString(terms.reviewedAt, "terms.reviewedAt"),
      checksum: typeof terms.checksum === "string" ? terms.checksum : undefined,
      notes: typeof terms.notes === "string" ? terms.notes : undefined,
    },
    releasePolicy: policy
      ? {
          public: typeof policy.public === "boolean" ? policy.public : undefined,
          required: typeof policy.required === "boolean" ? policy.required : undefined,
          redistributeRaw: typeof policy.redistributeRaw === "boolean" ? policy.redistributeRaw : undefined,
        }
      : undefined,
  };
}

export function listSourceDirs(): { sourceId: string; dir: string }[] {
  const adaptersRoot = repoPath("adapters");
  const out: { sourceId: string; dir: string }[] = [];
  if (!fs.existsSync(adaptersRoot)) return out;
  for (const jurisdiction of fs.readdirSync(adaptersRoot).sort()) {
    const jurDir = path.join(adaptersRoot, jurisdiction);
    if (!fs.statSync(jurDir).isDirectory()) continue;
    for (const source of fs.readdirSync(jurDir).sort()) {
      const dir = path.join(jurDir, source);
      if (!fs.statSync(dir).isDirectory()) continue;
      if (!fs.existsSync(path.join(dir, "source.yaml"))) continue;
      const desc = loadSourceDescriptor(dir);
      out.push({ sourceId: desc.sourceId, dir });
    }
  }
  return out;
}

export function sourceDirFor(sourceId: string): string | undefined {
  return listSourceDirs().find((s) => s.sourceId === sourceId)?.dir;
}

export function loadSourceDescriptorById(sourceId: string): SourceDescriptor {
  const dir = sourceDirFor(sourceId);
  if (!dir) throw new Error(`No source.yaml for ${sourceId}`);
  return loadSourceDescriptor(dir);
}

export function metadataFromDescriptor(desc: SourceDescriptor): AdapterMetadata {
  return {
    sourceId: desc.sourceId,
    identityAuthority: desc.identityAuthority,
    jurisdiction: desc.jurisdiction,
    credentialsRequired: desc.credentialsRequired,
    commercialUse: desc.commercialUse,
    redistribution: desc.redistribution,
    attributionRequired: desc.attributionRequired,
    updateFrequency: desc.updateFrequency,
    termsUrl: desc.terms.url,
  };
}

export function snapshotTerms(desc: SourceDescriptor): { termsReviewedAt: string; termsChecksum?: string } {
  return {
    termsReviewedAt: desc.terms.reviewedAt,
    termsChecksum: desc.terms.checksum,
  };
}
