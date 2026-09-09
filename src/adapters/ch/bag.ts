import fs from "node:fs";
import path from "node:path";
import type { Catalogue, MappingCoverageReport, Reimbursement, SourceSnapshot } from "../../canonical/types.js";
import { repoPath } from "../../paths.js";
import { extractZip, fetchBinary, sha256 } from "../../security.js";
import { loadSourceDescriptor, metadataFromDescriptor, snapshotTerms } from "../descriptor.js";
import type { Adapter, AdapterContext, AdapterMetadata, FetchResult, PartialCatalogue } from "../types.js";

const ADAPTER_DIR = repoPath("adapters/ch/bag");
const PINNED_EPL = "http://fhir.ch/ig/ch-epl/";
const PINNED_VERSION = "1.0.1";

export class BagAdapter implements Adapter {
  metadata(): AdapterMetadata {
    return metadataFromDescriptor(loadSourceDescriptor(ADAPTER_DIR));
  }

  async fetch(ctx: AdapterContext): Promise<FetchResult> {
    const work = path.join(ctx.cacheDir, "bag");
    fs.mkdirSync(work, { recursive: true });
    if (!ctx.inputPath) {
      throw new Error("BAG fetch requires --input until a stable FHIR export URL is recorded");
    }
    const buf = fs.readFileSync(ctx.inputPath);
    const dest = path.join(work, "extracted");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      await extractZip(buf, dest);
    } else {
      fs.writeFileSync(path.join(dest, path.basename(ctx.inputPath)), buf);
    }
    return {
      files: walkFiles(dest),
      snapshot: {
        id: sha256(buf).slice(0, 16),
        sourceId: "bag",
        identityAuthority: "bag",
        retrievedAt: new Date(0).toISOString(),
        sha256: sha256(buf),
        uri: `file:${ctx.inputPath}`,
        ...snapshotTerms(loadSourceDescriptor(ADAPTER_DIR)),
      },
    };
  }

  async validateSource(_ctx: AdapterContext, fetched: FetchResult): Promise<void> {
    const resources = loadFhirResources(fetched.files);
    if (resources.length === 0) throw new Error("BAG input contained no FHIR resources");
    for (const res of resources) {
      const profiles = (res.meta?.profile ?? []) as string[];
      for (const p of profiles) {
        if (p.startsWith(PINNED_EPL) && p.includes("ch-epl") && !p.includes(PINNED_VERSION) && /StructureDefinition/.test(p) === false) {
          // Canonical profile URLs often omit version; version is in meta.tag or package.
        }
        const versionHint = p.match(/ch-epl[/-](\d+\.\d+\.\d+)/);
        if (versionHint && versionHint[1] !== PINNED_VERSION) {
          throw new Error(
            `BAG advertised CH EPL ${versionHint[1]} via meta.profile (${p}); pinned input contract is ${PINNED_VERSION}. Upgrade the pin explicitly.`,
          );
        }
      }
      const recorded = JSON.stringify(profiles);
      if (recorded.includes("ch-epl") && /ch-epl\/(\d+\.\d+\.\d+)/.test(recorded)) {
        const ver = recorded.match(/ch-epl\/(\d+\.\d+\.\d+)/)?.[1];
        if (ver && ver !== PINNED_VERSION) {
          throw new Error(`BAG meta.profile advertises CH EPL ${ver}; pin is ${PINNED_VERSION}`);
        }
      }
    }
  }

  async parse(_ctx: AdapterContext, fetched: FetchResult): Promise<unknown[]> {
    return loadFhirResources(fetched.files);
  }

  async normalize(
    _ctx: AdapterContext,
    parsed: unknown,
    snapshot: SourceSnapshot,
  ): Promise<PartialCatalogue> {
    const resources = parsed as FhirResource[];
    const reimbursements: Reimbursement[] = [];
    // Join happens in compose using identifiers; here we only stash snapshots.
    void resources;
    void reimbursements;
    return {
      productGroups: [],
      medicinalProducts: [],
      packages: [],
      organizations: [],
      authorizations: [],
      substances: [],
      reimbursements,
      sourceSnapshots: [snapshot],
      mappingCoverage: [
        {
          sourceId: "bag",
          fields: [{ name: "resourceType", classification: "mapped", count: resources.length }],
          unknownFields: [],
        },
      ],
    };
  }

  qualityReport(catalogue: Catalogue): MappingCoverageReport {
    return catalogue.mappingCoverage.find((m) => m.sourceId === "bag") ?? {
      sourceId: "bag",
      fields: [],
      unknownFields: [],
    };
  }
}

export interface FhirResource {
  resourceType: string;
  id?: string;
  meta?: { profile?: string[]; source?: string };
  identifier?: { system?: string; value?: string }[];
  [key: string]: unknown;
}

export function applyBag(catalogue: Catalogue, resources: FhirResource[], snapshot: SourceSnapshot): void {
  const byGtin = new Map<string, FhirResource>();
  const byAuthPack = new Map<string, FhirResource>();
  for (const res of resources) {
    for (const id of res.identifier ?? []) {
      if (id.system?.includes("gtin") && id.value) byGtin.set(id.value, res);
      if (id.system?.toLowerCase().includes("swissmedic") && id.value) {
        byAuthPack.set(id.value, res);
      }
    }
  }
  for (const pkg of catalogue.packages) {
    const hit =
      (pkg.gtin ? byGtin.get(pkg.gtin) : undefined) ??
      byAuthPack.get(pkg.metadata?.packCode ? `${pkg.authorityKey.split("|")[0]}|${pkg.metadata.packCode}` : "") ??
      byAuthPack.get(pkg.authorityKey.split("|")[0] ?? "");
    if (!hit) continue;
    pkg.reimbursementStatus = {
      system: "https://fhir.openmedicationcatalog.org/CodeSystem/ch-bag-listing",
      code: "listed",
      display: "Listed on Spezialitätenliste",
    };
    pkg.fieldProvenance.reimbursementStatus = {
      sourceId: "bag",
      snapshotId: snapshot.id,
      originalField: "resourceType",
    };
    catalogue.reimbursements.push({
      packageId: pkg.id,
      status: pkg.reimbursementStatus,
      fieldProvenance: pkg.fieldProvenance.reimbursementStatus,
    });
  }
}

export function loadFhirResources(files: string[]): FhirResource[] {
  const out: FhirResource[] = [];
  for (const file of files) {
    if (!/\.(json|ndjson)$/i.test(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    if (file.endsWith(".ndjson")) {
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        out.push(JSON.parse(line) as FhirResource);
      }
      continue;
    }
    const doc = JSON.parse(raw) as FhirResource & { entry?: { resource: FhirResource }[] };
    if (doc.resourceType === "Bundle" && doc.entry) {
      for (const e of doc.entry) if (e.resource) out.push(e.resource);
    } else if (doc.resourceType) {
      out.push(doc);
    }
  }
  return out;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

void fetchBinary;
