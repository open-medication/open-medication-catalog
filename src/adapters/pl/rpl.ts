import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { authorityKey } from "../../branded.js";
import {
  OMC_SYSTEMS,
  RPL_SYSTEMS,
  WHO_ATC_SYSTEM,
  type Authorization,
  type Catalogue,
  type CodedValue,
  type DeclarationRow,
  type Ingredient,
  type MappingCoverageReport,
  type MedicinalProduct,
  type Organization,
  type Package,
  type SourceSnapshot,
  type Substance,
} from "../../canonical/types.js";
import { fhirCode } from "../../fhir/serialize.js";
import { canonicalId } from "../../identity.js";
import { repoPath } from "../../paths.js";
import {
  HttpStatusError,
  extractZip,
  fetchBinary,
  fileSignatureOk,
  httpExists,
  sha256,
  writeDeterministicZip,
} from "../../security.js";
import { asArray, optionalText, parseXmlFile, text } from "../../xml.js";
import { loadSourceDescriptor, metadataFromDescriptor, snapshotTerms } from "../descriptor.js";
import { SourceNotYetAvailableError } from "../ch/swissmedic.js";
import type { Adapter, AdapterContext, AdapterMetadata, FetchResult, PartialCatalogue } from "../types.js";
import { RplValue, RplXml } from "./rpl-xml.js";

const ADAPTER_DIR = repoPath("adapters/pl/rpl");
const JURISDICTION = "PL";
const AUTHORITY = "rpl";
export const RPL_OVERALL_XML = "overall.xml";

interface MappingFile {
  files: Record<string, Record<string, MappingCoverageReport["fields"][number]["classification"]>>;
}

interface RplParsed {
  products: Record<string, unknown>[];
  exportDate?: string;
  coverage: MappingCoverageReport;
  ignoredVeterinary: number;
  ignoredIncomplete: number;
}

export class RplAdapter implements Adapter {
  metadata(): AdapterMetadata {
    return metadataFromDescriptor(loadSourceDescriptor(ADAPTER_DIR));
  }

  async fetch(ctx: AdapterContext): Promise<FetchResult> {
    const work = path.join(ctx.cacheDir, "rpl");
    fs.mkdirSync(work, { recursive: true });

    if (ctx.inputPath) {
      return loadInput(ctx, work);
    }

    const url = rplDownloadUrl();
    let buf: Buffer;
    try {
      buf = await fetchBinary(url);
    } catch (err) {
      if (err instanceof HttpStatusError && (err.status === 404 || err.status === 403)) {
        throw new SourceNotYetAvailableError(`RPL overall.xml is not yet available (${err.status})`);
      }
      throw err;
    }
    if (!fileSignatureOk(buf, "xml")) throw new Error("RPL download is not XML");

    const dest = path.join(work, "extracted");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, RPL_OVERALL_XML), buf);
    const archiveCopy = path.join(work, `RPL_${ctx.archiveMonth}.zip`);
    await writeDeterministicZip([{ name: RPL_OVERALL_XML, data: buf }], archiveCopy);
    return {
      files: [path.join(dest, RPL_OVERALL_XML)],
      rawArchivePath: archiveCopy,
      snapshot: snapshotFrom(fs.readFileSync(archiveCopy), ctx, url),
    };
  }

  async validateSource(_ctx: AdapterContext, fetched: FetchResult): Promise<void> {
    if (!findOverall(extractDir(fetched))) throw new Error(`Missing RPL file: ${RPL_OVERALL_XML}`);
  }

  async parse(_ctx: AdapterContext, fetched: FetchResult): Promise<RplParsed> {
    const fp = findOverall(extractDir(fetched));
    if (!fp) throw new Error(`Missing RPL file: ${RPL_OVERALL_XML}`);
    const mapping = loadMapping();
    const expected = new Set(Object.keys(mapping.files[RPL_OVERALL_XML] ?? {}));
    const coverage: MappingCoverageReport = { sourceId: "rpl", fields: [], unknownFields: [] };
    const seen = new Map<string, number>();

    const doc = parseXmlFile(fp) as Record<string, unknown>;
    const root = findRoot(doc);
    const exportDate = attr(root, RplXml.asOfDate);
    countField(seen, RplXml.asOfDate);
    walkFieldNames(root, seen);

    const products = asArray(root[RplXml.medicinalProduct]).filter(
      (p): p is Record<string, unknown> => Boolean(p) && typeof p === "object" && !Array.isArray(p),
    );

    let ignoredVeterinary = 0;
    let ignoredIncomplete = 0;
    for (const product of products) {
      if (!attr(product, RplXml.id)) ignoredIncomplete += 1;
      else if (!isHuman(product)) ignoredVeterinary += 1;
    }
    seen.set(RplXml.veterinaryIgnored, ignoredVeterinary);
    seen.set(RplXml.incompleteIgnored, ignoredIncomplete);

    for (const key of seen.keys()) {
      if (!expected.has(key) && !coverage.unknownFields.includes(key)) {
        coverage.unknownFields.push(key);
      }
    }
    for (const [name, classification] of Object.entries(mapping.files[RPL_OVERALL_XML] ?? {})) {
      coverage.fields.push({ name: `${RPL_OVERALL_XML}.${name}`, classification, count: seen.get(name) ?? 0 });
    }
    if (coverage.unknownFields.length > 0) {
      console.warn(`RPL unknown fields: ${coverage.unknownFields.join(", ")}`);
    }

    return { products, exportDate, coverage, ignoredVeterinary, ignoredIncomplete };
  }

  async normalize(_ctx: AdapterContext, parsed: unknown, snapshot: SourceSnapshot): Promise<PartialCatalogue> {
    const data = parsed as RplParsed;
    if (data.exportDate) snapshot.sourceEffectiveDate = data.exportDate;

    const organizations: Organization[] = [];
    const orgByKey = new Map<string, Organization>();
    const medicinalProducts: MedicinalProduct[] = [];
    const packages: Package[] = [];
    const authorizations: Authorization[] = [];
    const authByKey = new Map<string, Authorization>();
    const substances: Substance[] = [];
    const substanceIds = new Set<string>();

    for (const row of data.products) {
      const productId = attr(row, RplXml.id);
      if (!productId) continue;
      if (!isHuman(row)) continue;

      const holderName = attr(row, RplXml.marketingAuthorisationHolder);
      const holder = holderName ? upsertOrg(orgByKey, organizations, holderName, snapshot) : undefined;
      const maNumber = attr(row, RplXml.authorisationNumber);
      const authKey = maNumber || productId;
      const mpId = canonicalId({
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        entityType: "MedicinalProduct",
        authorityKey: authorityKey([productId]),
      });
      const authId = canonicalId({
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        entityType: "Authorization",
        authorityKey: authorityKey([authKey]),
      });

      const names = productNames(row);
      const atcCodes = asArray(nested(row, RplXml.atcCodes)?.[RplXml.atcCode])
        .map((c) => text(c).trim())
        .filter(Boolean);
      const routes = asArray(nested(row, RplXml.routesOfAdministration)?.[RplXml.routeOfAdministration])
        .map((r) => (typeof r === "object" && r ? attr(r as Record<string, unknown>, RplXml.routeName) : text(r).trim()))
        .filter(Boolean)
        .map((r) => coded(RPL_SYSTEMS.route, r)!);

      const substanceRows = asArray(nested(row, RplXml.activeSubstances)?.[RplXml.activeSubstance]).filter(
        (s): s is Record<string, unknown> => Boolean(s) && typeof s === "object" && !Array.isArray(s),
      );
      const composition = buildComposition(snapshot, productId, substanceRows);
      for (const s of composition.substances) {
        if (!substanceIds.has(s.id)) {
          substanceIds.add(s.id);
          substances.push(s);
        }
      }

      const status = coded(RPL_SYSTEMS.regulatoryStatus, attr(row, RplXml.authorisationValidity) || "unknown")!;
      medicinalProducts.push({
        id: mpId,
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: productId,
        names,
        doseForm: coded(RPL_SYSTEMS.doseForm, attr(row, RplXml.doseFormName)),
        routes,
        regulatoryStatus: status,
        authorizationId: authId,
        identifiers: [
          { system: RPL_SYSTEMS.product, value: productId, use: "official" },
          ...atcCodes.map((code) => ({ system: WHO_ATC_SYSTEM, value: code })),
        ],
        declarationRows: composition.declarationRows,
        ingredients: composition.ingredients,
        sourceRecords: [ref(snapshot, productId)],
        metadata: compactMeta({
          [RplXml.strength]: attr(row, RplXml.strength),
          atc: atcCodes.join(" "),
          [RplXml.procedureType]: attr(row, RplXml.procedureType),
          [RplXml.authorisationValidity]: attr(row, RplXml.authorisationValidity),
          [RplXml.previousProductName]: blankish(attr(row, RplXml.previousProductName)),
          [RplXml.legalBasis]: attr(row, RplXml.legalBasis),
          [RplXml.animalUseProhibition]: attr(row, RplXml.animalUseProhibition),
          [RplXml.patientLeafletUrl]: attr(row, RplXml.patientLeafletUrl),
          [RplXml.smpcUrl]: attr(row, RplXml.smpcUrl),
          [RplXml.packageLeafletAndLabellingUrl]: attr(row, RplXml.packageLeafletAndLabellingUrl),
          [RplXml.parallelImportPackageLeafletAndLabellingUrl]: attr(
            row,
            RplXml.parallelImportPackageLeafletAndLabellingUrl,
          ),
          [RplXml.parallelImportLeafletUrl]: attr(row, RplXml.parallelImportLeafletUrl),
          [RplXml.parallelImportPackageMarkingUrl]: attr(row, RplXml.parallelImportPackageMarkingUrl),
        }),
      });

      let auth = authByKey.get(authKey);
      if (!auth) {
        auth = {
          id: authId,
          jurisdiction: JURISDICTION,
          identityAuthority: AUTHORITY,
          authorityKey: authKey,
          holderId: holder?.id,
          status,
          medicinalProductIds: [mpId],
          identifiers: [{ system: RPL_SYSTEMS.authorisation, value: authKey }],
          sourceRecords: [ref(snapshot, authKey)],
        };
        authByKey.set(authKey, auth);
        authorizations.push(auth);
      } else {
        auth.medicinalProductIds.push(mpId);
      }

      const packRows = asArray(nested(row, RplXml.packages)?.[RplXml.pack]).filter(
        (p): p is Record<string, unknown> => Boolean(p) && typeof p === "object" && !Array.isArray(p),
      );
      for (const pack of packRows) {
        const packId = attr(pack, RplXml.id) || "";
        const gtinRaw = attr(pack, RplXml.gtinCode);
        const gtin = gtinDigits(gtinRaw);
        const packKey = gtin || (packId ? `${productId}|${packId}` : "");
        if (!packKey) continue;
        const description = packDescription(pack) || gtinRaw || packKey;
        packages.push({
          id: canonicalId({
            jurisdiction: JURISDICTION,
            identityAuthority: AUTHORITY,
            entityType: "Package",
            authorityKey: authorityKey([packKey]),
          }),
          jurisdiction: JURISDICTION,
          identityAuthority: AUTHORITY,
          authorityKey: packKey,
          medicinalProductId: mpId,
          description,
          quantity: packQuantity(pack),
          regulatoryStatus: packStatus(pack),
          gtin,
          names: description ? [{ text: description, language: "pl" }] : undefined,
          identifiers: packIdentifiers(packKey, gtin, packId),
          fieldProvenance: {
            description: { sourceId: "rpl", snapshotId: snapshot.id, originalField: RplXml.packUnits },
          },
          sourceRecords: [ref(snapshot, packKey)],
          metadata: compactMeta({
            [RplXml.gtinCode]: gtinRaw,
            packId,
            [RplXml.availabilityCategory]: attr(pack, RplXml.availabilityCategory),
            [RplXml.cancelled]: attr(pack, RplXml.cancelled),
            [RplXml.euNumber]: attr(pack, RplXml.euNumber),
            [RplXml.parallelDistributor]: attr(pack, RplXml.parallelDistributor),
            ...packConsentMeta(pack),
          }),
        });
      }
    }

    return {
      productGroups: [],
      medicinalProducts,
      packages,
      organizations,
      authorizations,
      substances,
      reimbursements: [],
      sourceSnapshots: [snapshot],
      mappingCoverage: [data.coverage],
    };
  }

  qualityReport(catalogue: Catalogue, _snapshot: SourceSnapshot): MappingCoverageReport {
    return catalogue.mappingCoverage.find((m) => m.sourceId === "rpl") ?? {
      sourceId: "rpl",
      fields: [],
      unknownFields: [],
    };
  }
}

export async function rplDumpAvailable(): Promise<boolean> {
  return httpExists(rplDownloadUrl());
}

export function rplDownloadUrl(): string {
  const raw = YAML.parse(fs.readFileSync(path.join(ADAPTER_DIR, "source.yaml"), "utf8")) as { downloadUrl?: string };
  if (!raw.downloadUrl) throw new Error("rpl source.yaml missing downloadUrl");
  return raw.downloadUrl;
}

function loadMapping(): MappingFile {
  return YAML.parse(fs.readFileSync(path.join(ADAPTER_DIR, "mapping.yaml"), "utf8")) as MappingFile;
}

function snapshotFrom(buf: Buffer, ctx: AdapterContext, uri: string): SourceSnapshot {
  return {
    id: sha256(buf).slice(0, 16),
    sourceId: "rpl",
    identityAuthority: AUTHORITY,
    retrievedAt: new Date(0).toISOString(),
    sourceEffectiveDate: ctx.cutoffDate,
    sha256: sha256(buf),
    uri,
    ...snapshotTerms(loadSourceDescriptor(ADAPTER_DIR)),
  };
}

function ref(snapshot: SourceSnapshot, recordKey: string) {
  return { sourceId: "rpl", snapshotId: snapshot.id, recordKey };
}

function coded(system: string, value?: string): CodedValue | undefined {
  const display = value?.trim();
  if (!display) return undefined;
  return { system, code: fhirCode(display), display };
}

function attr(node: Record<string, unknown>, name: string): string | undefined {
  return optionalText(node[`@_${name}`] ?? node[name]);
}

function nested(node: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  const value = node[name];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function isHuman(row: Record<string, unknown>): boolean {
  return (attr(row, RplXml.preparationType) ?? "").trim().toLowerCase() === RplValue.human;
}

function blankish(value?: string): string | undefined {
  if (!value) return undefined;
  const t = value.trim();
  if (!t || t.toLowerCase() === RplValue.none) return undefined;
  return t;
}

function productNames(row: Record<string, unknown>): MedicinalProduct["names"] {
  const names: MedicinalProduct["names"] = [];
  const trade = attr(row, RplXml.productName);
  const inn = attr(row, RplXml.commonName);
  if (trade) names.push({ text: trade, language: "pl" });
  if (inn && inn !== trade) names.push({ text: inn, language: "pl" });
  if (names.length === 0) names.push({ text: attr(row, RplXml.id) || "unknown", language: "pl" });
  return names;
}

function gtinDigits(value?: string): string | undefined {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length === 13 || digits.length === 14) return digits;
  return undefined;
}

function packIdentifiers(packKey: string, gtin: string | undefined, packId: string): Package["identifiers"] {
  const identifiers: Package["identifiers"] = [{ system: RPL_SYSTEMS.package, value: packKey, use: "official" }];
  if (gtin) identifiers.push({ system: OMC_SYSTEMS.gtin, value: gtin });
  if (packId && packId !== packKey) identifiers.push({ system: RPL_SYSTEMS.package, value: packId, use: "secondary" });
  return identifiers;
}

function packUnits(pack: Record<string, unknown>): Record<string, unknown>[] {
  return asArray(nested(pack, RplXml.packUnits)?.[RplXml.packUnit]).filter(
    (u): u is Record<string, unknown> => Boolean(u) && typeof u === "object" && !Array.isArray(u),
  );
}

function packDescription(pack: Record<string, unknown>): string | undefined {
  const parts = packUnits(pack).map((u) => {
    const count = attr(u, RplXml.packCount);
    const kind = attr(u, RplXml.packKind);
    const size = attr(u, RplXml.capacity);
    const unit = attr(u, RplXml.capacityUnit);
    const extra = attr(u, RplXml.additionalInfo);
    return [count && kind ? `${count}× ${kind}` : kind, [size, unit].filter(Boolean).join(" "), extra]
      .filter(Boolean)
      .join(" ")
      .trim();
  });
  return parts.filter(Boolean).join("; ") || undefined;
}

function packQuantity(pack: Record<string, unknown>): Package["quantity"] {
  const first = packUnits(pack)[0];
  const size = first ? attr(first, RplXml.capacity) : undefined;
  const unit = first ? attr(first, RplXml.capacityUnit) : undefined;
  return {
    value: size,
    unit: unit ? coded(RPL_SYSTEMS.packageUnit, unit) : undefined,
    structured: Boolean(size && unit && /^\d+([.,]\d+)?$/.test(size)),
  };
}

function packStatus(pack: Record<string, unknown>): CodedValue {
  const withdrawn = (attr(pack, RplXml.cancelled) ?? "").trim().toUpperCase() === RplValue.yes;
  return coded(RPL_SYSTEMS.regulatoryStatus, withdrawn ? RplValue.cancelled : RplValue.active)!;
}

function upsertOrg(
  orgByKey: Map<string, Organization>,
  organizations: Organization[],
  name: string,
  snapshot: SourceSnapshot,
): Organization {
  const orgKey = authorityKey([name]);
  const existing = orgByKey.get(orgKey);
  if (existing) return existing;
  const org: Organization = {
    id: canonicalId({
      jurisdiction: JURISDICTION,
      identityAuthority: AUTHORITY,
      entityType: "Organization",
      authorityKey: orgKey,
    }),
    jurisdiction: JURISDICTION,
    identityAuthority: AUTHORITY,
    authorityKey: orgKey,
    name,
    role: "marketing-authorisation-holder",
    identifiers: [{ system: RPL_SYSTEMS.organization, value: name }],
    sourceRecords: [ref(snapshot, `${RplXml.marketingAuthorisationHolder}:${name}`)],
  };
  orgByKey.set(orgKey, org);
  organizations.push(org);
  return org;
}

function buildComposition(
  snapshot: SourceSnapshot,
  productId: string,
  rows: Record<string, unknown>[],
): { declarationRows: DeclarationRow[]; ingredients: Ingredient[]; substances: Substance[] } {
  const declarationRows: DeclarationRow[] = [];
  const ingredients: Ingredient[] = [];
  const substances: Substance[] = [];
  rows.forEach((row, index) => {
    const name = attr(row, RplXml.substanceName) || "unknown";
    const qty = attr(row, RplXml.substanceQuantity);
    const qtyUnit = attr(row, RplXml.substanceQuantityUnit);
    const prepQty = attr(row, RplXml.preparationQuantity);
    const prepUnit = attr(row, RplXml.preparationQuantityUnit);
    const other = attr(row, RplXml.otherQuantityDescription);
    const rowNo = String(index + 1);
    const rowKey = authorityKey([productId, name, rowNo]);
    const rowId = canonicalId({
      jurisdiction: JURISDICTION,
      identityAuthority: AUTHORITY,
      entityType: "DeclarationRow",
      authorityKey: rowKey,
    });
    const sid = canonicalId({
      jurisdiction: JURISDICTION,
      identityAuthority: AUTHORITY,
      entityType: "Substance",
      authorityKey: authorityKey([name]),
    });
    substances.push({
      id: sid,
      identityAuthority: AUTHORITY,
      authorityKey: name,
      name,
      identifiers: [{ system: RPL_SYSTEMS.substance, value: name }],
    });
    const role = coded(RPL_SYSTEMS.ingredientRole, RplValue.activeSubstanceRole)!;
    const strengthText = [name, qty, qtyUnit, prepQty && prepUnit ? `/ ${prepQty} ${prepUnit}` : undefined, other]
      .filter(Boolean)
      .join(" ");
    declarationRows.push({
      id: rowId,
      componentNumber: "1",
      rowNumber: rowNo,
      sortOrder: rowNo,
      rowType: RplValue.activeSubstanceRole,
      substanceId: sid,
      sourceSubstanceId: name,
      substanceName: name,
      roleCode: role,
      quantity: qty,
      quantityUnit: qtyUnit ? coded(RPL_SYSTEMS.quantityUnit, qtyUnit) : undefined,
      sourceText: strengthText,
    });
    ingredients.push({
      id: canonicalId({
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        entityType: "Ingredient",
        authorityKey: rowKey,
      }),
      declarationRowId: rowId,
      name,
      role,
      strength: { text: strengthText, structured: false },
    });
  });
  return { declarationRows, ingredients, substances };
}

function packConsentMeta(pack: Record<string, unknown>): Record<string, string | undefined> {
  const consents = asArray(nested(pack, RplXml.presidentConsents)?.[RplXml.presidentConsent]).filter(
    (c): c is Record<string, unknown> => Boolean(c) && typeof c === "object" && !Array.isArray(c),
  );
  const numbers: string[] = [];
  const foreign: string[] = [];
  for (const consent of consents) {
    const nr = attr(consent, RplXml.presidentConsentNumber) || text(consent[RplXml.presidentConsentNumber]).trim();
    if (nr) numbers.push(nr);
    const gtinRows = asArray(nested(consent, RplXml.foreignGtins)?.[RplXml.foreignGtin]).filter(
      (g): g is Record<string, unknown> => Boolean(g) && typeof g === "object" && !Array.isArray(g),
    );
    for (const gtin of gtinRows) {
      const n = attr(gtin, RplXml.number);
      if (n) foreign.push(n);
    }
  }
  return {
    [RplXml.presidentConsentNumber]: numbers.join("; ") || undefined,
    [RplXml.foreignGtin]: foreign.join(" ") || undefined,
  };
}

function compactMeta(values: Record<string, string | undefined>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    const t = v?.trim();
    if (t) out[k] = t;
  }
  return Object.keys(out).length ? out : undefined;
}

function findRoot(doc: Record<string, unknown>): Record<string, unknown> {
  const root = doc[RplXml.medicinalProducts];
  if (root && typeof root === "object") {
    return root as Record<string, unknown>;
  }
  throw new Error(`RPL XML is missing ${RplXml.medicinalProducts} root`);
}

function walkFieldNames(node: unknown, seen: Map<string, number>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkFieldNames(item, seen);
    return;
  }
  const rec = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(rec)) {
    if (key.startsWith("?") || key === "#text") continue;
    if (key.startsWith("@_")) {
      countField(seen, key.slice(2));
      continue;
    }
    countField(seen, key);
    walkFieldNames(value, seen);
  }
}

function countField(seen: Map<string, number>, name: string): void {
  seen.set(name, (seen.get(name) ?? 0) + 1);
}

async function loadInput(ctx: AdapterContext, work: string): Promise<FetchResult> {
  const input = ctx.inputPath!;
  const dest = path.join(work, "extracted");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  if (fs.statSync(input).isDirectory()) {
    const found = findOverall(input);
    if (!found) throw new Error(`Missing RPL file in input dir: ${RPL_OVERALL_XML}`);
    const data = fs.readFileSync(found);
    fs.writeFileSync(path.join(dest, RPL_OVERALL_XML), data);
    const archiveCopy = path.join(work, path.basename(input) + ".zip");
    await writeDeterministicZip([{ name: RPL_OVERALL_XML, data }], archiveCopy);
    return {
      files: [path.join(dest, RPL_OVERALL_XML)],
      rawArchivePath: archiveCopy,
      snapshot: snapshotFrom(fs.readFileSync(archiveCopy), ctx, `file:${input}`),
    };
  }

  const buf = fs.readFileSync(input);
  if (fileSignatureOk(buf, "zip")) {
    await extractZip(buf, dest);
    const found = findOverall(dest) ?? findOverallNested(dest);
    if (!found) throw new Error(`Missing RPL file after extract: ${RPL_OVERALL_XML}`);
    const archiveCopy = path.join(work, path.basename(input));
    fs.copyFileSync(input, archiveCopy);
    return {
      files: [found],
      rawArchivePath: archiveCopy,
      snapshot: snapshotFrom(buf, ctx, `file:${input}`),
    };
  }
  throw new Error("RPL input must be a zip containing overall.xml or a directory containing it");
}

function extractDir(fetched: FetchResult): string {
  const first = fetched.files[0];
  if (!first) throw new Error("No RPL files");
  return path.dirname(first);
}

function findOverall(dir: string): string | undefined {
  const direct = path.join(dir, RPL_OVERALL_XML);
  if (fs.existsSync(direct)) return direct;
  const found = fs.readdirSync(dir).find((f) => f.toLowerCase() === RPL_OVERALL_XML);
  return found ? path.join(dir, found) : undefined;
}

function findOverallNested(dir: string): string | undefined {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) {
      const found = findOverall(p) ?? findOverallNested(p);
      if (found) return found;
    }
  }
  return undefined;
}
