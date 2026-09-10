import fs from "node:fs";
import path from "node:path";
import type { Catalogue, MappingCoverageReport, ProductPrice, Reimbursement, SourceSnapshot } from "../../canonical/types.js";
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
          fields: [
            { name: "resourceType", classification: "mapped", count: resources.length },
            { name: "reimbursementSL", classification: "mapped", count: resources.length },
          ],
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
  const clinicalById = new Map<string, FhirResource>();
  for (const res of resources) {
    if (res.resourceType === "ClinicalUseDefinition" && res.id) clinicalById.set(res.id, res);
  }

  const ppdByGtin = new Map<string, FhirResource>();
  for (const res of resources) {
    if (res.resourceType !== "PackagedProductDefinition") continue;
    for (const gtin of gtinsOf(res)) ppdByGtin.set(gtin, res);
  }

  const raByPpdId = new Map<string, FhirResource>();
  for (const res of resources) {
    if (res.resourceType !== "RegulatedAuthorization") continue;
    if (!hasReimbursementSl(res)) continue;
    for (const sub of subjectRefs(res)) {
      const id = localId(sub);
      if (id) raByPpdId.set(id, res);
    }
  }

  let joined = 0;
  for (const pkg of catalogue.packages) {
    const ppd = pkg.gtin ? ppdByGtin.get(pkg.gtin) : undefined;
    const ra = ppd?.id ? raByPpdId.get(ppd.id) : undefined;
    if (!ra) continue;
    const sl = reimbursementSl(resExtensions(ra));
    if (!sl) continue;
    joined += 1;
    const listing = sl.listingStatus ?? sl.status;
    if (listing) {
      pkg.reimbursementStatus = listing;
      pkg.fieldProvenance.reimbursementStatus = {
        sourceId: "bag",
        snapshotId: snapshot.id,
        originalField: "reimbursementSL.listingStatus",
      };
    }
    const prices = sl.prices;
    const retail = prices.find((p) => /retail|public|verkauf/i.test(p.type?.display ?? p.type?.code ?? ""));
    const row: Reimbursement = {
      packageId: pkg.id,
      status: sl.status ?? listing ?? { system: "https://fhir.openmedicationcatalog.org/CodeSystem/ch-bag-listing", code: "listed" },
      price: retail
        ? { value: retail.value, currency: retail.currency }
        : prices[0]
          ? { value: prices[0].value, currency: prices[0].currency }
          : undefined,
      prices: prices.length ? prices : undefined,
      limitations: limitationText(ra, clinicalById),
      validFrom: sl.listingPeriodStart,
      validTo: sl.listingPeriodEnd,
      firstListingDate: sl.firstListingDate,
      expiryDate: sl.expiryDate,
      costShare: sl.costShare,
      gamme: sl.gamme,
      dossierNumber: sl.dossierNumber,
      fieldProvenance: {
        sourceId: "bag",
        snapshotId: snapshot.id,
        originalField: "reimbursementSL",
      },
    };
    catalogue.reimbursements.push(row);
  }

  const coverage = catalogue.mappingCoverage.find((m) => m.sourceId === "bag");
  if (coverage) {
    coverage.fields.push({ name: "joinedPackages", classification: "mapped", count: joined });
  }
}

interface ParsedSl {
  status?: { system: string; code: string; display?: string };
  listingStatus?: { system: string; code: string; display?: string };
  listingPeriodStart?: string;
  listingPeriodEnd?: string;
  firstListingDate?: string;
  expiryDate?: string;
  costShare?: number;
  gamme?: { system: string; code: string; display?: string };
  dossierNumber?: string;
  prices: ProductPrice[];
}

function hasReimbursementSl(res: FhirResource): boolean {
  return resExtensions(res).some((e) => String(e.url ?? "").includes("reimbursementSL"));
}

function reimbursementSl(exts: FhirExt[]): ParsedSl | undefined {
  const root = exts.find((e) => String(e.url ?? "").includes("reimbursementSL"));
  if (!root) return undefined;
  const kids = asExts(root.extension);
  const prices: ProductPrice[] = [];
  for (const k of kids) {
    if (String(k.url ?? "").includes("productPrice")) {
      const p = parseProductPrice(k);
      if (p) prices.push(p);
    }
  }
  return {
    status: codedFromExt(kids, "status"),
    listingStatus: codedFromExt(kids, "listingStatus"),
    listingPeriodStart: periodStart(kids, "listingPeriod"),
    listingPeriodEnd: periodEnd(kids, "listingPeriod"),
    firstListingDate: dateFromExt(kids, "firstListingDate"),
    expiryDate: dateFromExt(kids, "expiryDate"),
    costShare: integerFromExt(kids, "costShare"),
    gamme: codedFromExt(kids, "gamme"),
    dossierNumber: identifierValue(kids, "FOPHDossierNumber"),
    prices,
  };
}

function parseProductPrice(ext: FhirExt): ProductPrice | undefined {
  const kids = asExts(ext.extension);
  const money = kids.find((k) => k.url === "value")?.valueMoney as { value?: number; currency?: string } | undefined;
  if (money?.value == null || !money.currency) return undefined;
  return {
    value: String(money.value),
    currency: money.currency,
    type: codedFromExt(kids, "type"),
    changeType: codedFromExt(kids, "changeType"),
    changeDate: dateFromExt(kids, "changeDate"),
  };
}

function limitationText(ra: FhirResource, clinicalById: Map<string, FhirResource>): string | undefined {
  const texts: string[] = [];
  const indications = asRefs(
    ra.indication as { extension?: FhirExt[]; reference?: { reference?: string } }[] | { extension?: FhirExt[]; reference?: { reference?: string } } | undefined,
  );
  for (const ind of indications) {
    const lim = asExts(ind.extension).find((e) => String(e.url ?? "").includes("regulatedAuthorization-limitation"));
    if (!lim) continue;
    const kids = asExts(lim.extension);
    const ref = referenceFromExt(kids, "limitationIndication");
    const id = ref ? localId(ref) : undefined;
    const cud = id ? clinicalById.get(id) : undefined;
    const desc = clinicalLimitationText(cud) ?? codedFromExt(kids, "status")?.display;
    if (desc) texts.push(desc);
  }
  return texts.length ? texts.join(" | ") : undefined;
}

function asRefs<T>(v: T[] | T | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function clinicalLimitationText(cud: FhirResource | undefined): string | undefined {
  if (!cud) return undefined;
  if (typeof cud.description === "string" && cud.description.trim()) return cud.description;
  const ind = cud.indication as
    | { diseaseSymptomProcedure?: { concept?: { text?: string } } }
    | undefined;
  const text = ind?.diseaseSymptomProcedure?.concept?.text;
  return text?.trim() || undefined;
}

interface FhirExt {
  url?: string;
  extension?: FhirExt[] | FhirExt;
  valueCodeableConcept?: { coding?: { system?: string; code?: string; display?: string }[] };
  valueDate?: string;
  valueInteger?: number;
  valueIdentifier?: { value?: string };
  valuePeriod?: { start?: string; end?: string };
  valueMoney?: { value?: number; currency?: string };
  valueReference?: { reference?: string };
  [key: string]: unknown;
}

function resExtensions(res: FhirResource): FhirExt[] {
  return asExts(res.extension as FhirExt[] | FhirExt | undefined);
}

function asExts(v: FhirExt[] | FhirExt | undefined): FhirExt[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function findExt(kids: FhirExt[], leaf: string): FhirExt | undefined {
  return kids.find((k) => {
    const u = String(k.url ?? "");
    return u === leaf || u.endsWith(`/${leaf}`) || u.endsWith(`#${leaf}`);
  });
}

function codedFromExt(
  kids: FhirExt[],
  url: string,
): { system: string; code: string; display?: string } | undefined {
  const coding = findExt(kids, url)?.valueCodeableConcept?.coding?.[0];
  if (!coding?.system || !coding.code) return undefined;
  return { system: coding.system, code: coding.code, display: coding.display };
}

function dateFromExt(kids: FhirExt[], url: string): string | undefined {
  return findExt(kids, url)?.valueDate;
}

function integerFromExt(kids: FhirExt[], url: string): number | undefined {
  const n = findExt(kids, url)?.valueInteger;
  return typeof n === "number" ? n : undefined;
}

function identifierValue(kids: FhirExt[], url: string): string | undefined {
  return findExt(kids, url)?.valueIdentifier?.value;
}

function periodStart(kids: FhirExt[], url: string): string | undefined {
  return findExt(kids, url)?.valuePeriod?.start;
}

function periodEnd(kids: FhirExt[], url: string): string | undefined {
  return findExt(kids, url)?.valuePeriod?.end;
}

function referenceFromExt(kids: FhirExt[], url: string): string | undefined {
  return findExt(kids, url)?.valueReference?.reference;
}

function subjectRefs(res: FhirResource): string[] {
  const raw = res.subject as { reference?: string }[] | { reference?: string } | undefined;
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((s) => s.reference).filter((r): r is string => Boolean(r));
}

function localId(ref: string): string | undefined {
  const parts = ref.split("/");
  return parts[parts.length - 1];
}

function gtinsOf(res: FhirResource): string[] {
  const out: string[] = [];
  const take = (id: { system?: string; value?: string } | undefined) => {
    if (id?.value && isGtinSystem(id.system)) out.push(id.value);
  };
  for (const id of res.identifier ?? []) take(id);
  walkPackaging(res.packaging, take);
  return out;
}

function walkPackaging(node: unknown, take: (id: { system?: string; value?: string }) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n) => walkPackaging(n, take));
    return;
  }
  const rec = node as { identifier?: { system?: string; value?: string }[]; packaging?: unknown };
  for (const id of rec.identifier ?? []) take(id);
  if (rec.packaging) walkPackaging(rec.packaging, take);
}

function isGtinSystem(system?: string): boolean {
  if (!system) return false;
  const s = system.toLowerCase();
  return s.includes("gtin") || s === "urn:oid:2.51.1.1" || s.includes("gs1.org");
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
