import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { authorityKey } from "../../branded.js";
import {
  FDA_SYSTEMS,
  type Authorization,
  type Catalogue,
  type CodedValue,
  type DeclarationRow,
  type Ingredient,
  type MappingCoverageReport,
  type MedicinalProduct,
  type Organization,
  type Package,
  type PackageQuantity,
  type SourceSnapshot,
  type Strength,
  type Substance,
  medicinalProductDomain,
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
import { loadSourceDescriptor, metadataFromDescriptor, snapshotTerms } from "../descriptor.js";
import { SourceNotYetAvailableError } from "../ch/swissmedic.js";
import type { Adapter, AdapterContext, AdapterMetadata, FetchResult, PartialCatalogue } from "../types.js";

const ADAPTER_DIR = repoPath("adapters/us/ndc");
const JURISDICTION = "US";
const AUTHORITY = "fda";
const SOURCE_ID = "ndc";

export const NDC_ZIP_URL = "https://www.accessdata.fda.gov/cder/ndctext.zip";
export const NDC_FILES = ["product.txt", "package.txt"] as const;

/**
 * Live `ndctext.zip` headers, plus the definition-page renames
 * (`StrengthNumber` / `StrengthUnit`) aliased onto the live names.
 */
const HEADER_ALIASES: Record<string, string> = {
  productid: "PRODUCTID",
  productndc: "PRODUCTNDC",
  producttypename: "PRODUCTTYPENAME",
  proprietaryname: "PROPRIETARYNAME",
  proprietarynamesuffix: "PROPRIETARYNAMESUFFIX",
  nonproprietaryname: "NONPROPRIETARYNAME",
  dosageformname: "DOSAGEFORMNAME",
  routename: "ROUTENAME",
  startmarketingdate: "STARTMARKETINGDATE",
  endmarketingdate: "ENDMARKETINGDATE",
  marketingcategoryname: "MARKETINGCATEGORYNAME",
  applicationnumber: "APPLICATIONNUMBER",
  labelername: "LABELERNAME",
  substancename: "SUBSTANCENAME",
  active_numerator_strength: "ACTIVE_NUMERATOR_STRENGTH",
  strengthnumber: "ACTIVE_NUMERATOR_STRENGTH",
  active_ingred_unit: "ACTIVE_INGRED_UNIT",
  strengthunit: "ACTIVE_INGRED_UNIT",
  pharm_classes: "PHARM_CLASSES",
  deaschedule: "DEASCHEDULE",
  ndc_exclude_flag: "NDC_EXCLUDE_FLAG",
  listing_record_certified_through: "LISTING_RECORD_CERTIFIED_THROUGH",
  ndcpackagecode: "NDCPACKAGECODE",
  packagedescription: "PACKAGEDESCRIPTION",
  sample_package: "SAMPLE_PACKAGE",
};

const ACTIVE_ROLE: CodedValue = {
  system: FDA_SYSTEMS.ingredientRole,
  code: "active",
  display: "Active ingredient",
};

interface MappingFile {
  files: Record<string, Record<string, MappingCoverageReport["fields"][number]["classification"]>>;
}

interface NdcParsed {
  files: Record<string, Record<string, string>[]>;
  coverage: MappingCoverageReport;
}

/** 10-digit hyphenated package NDC (4-4-2, 5-3-2, or 5-4-1) → 11-digit HIPAA 5-4-2. */
export function hipaaNdc11(ndcPackageCode: string): string | undefined {
  const parts = ndcPackageCode.trim().split("-");
  if (parts.length !== 3 || !parts.every((part) => /^\d+$/.test(part))) return undefined;
  const [labeler, product, pack] = parts as [string, string, string];
  let nextLabeler = labeler;
  let nextProduct = product;
  let nextPack = pack;
  if (labeler.length === 4 && product.length === 4 && pack.length === 2) nextLabeler = `0${labeler}`;
  else if (labeler.length === 5 && product.length === 3 && pack.length === 2) nextProduct = `0${product}`;
  else if (labeler.length === 5 && product.length === 4 && pack.length === 1) nextPack = `0${pack}`;
  else return undefined;
  const digits = `${nextLabeler}${nextProduct}${nextPack}`;
  return digits.length === 11 ? digits : undefined;
}

export function canonicalNdcHeader(header: string): string | undefined {
  return HEADER_ALIASES[header.trim().toLowerCase()];
}

export class NdcAdapter implements Adapter {
  metadata(): AdapterMetadata {
    return metadataFromDescriptor(loadSourceDescriptor(ADAPTER_DIR));
  }

  async fetch(ctx: AdapterContext): Promise<FetchResult> {
    const work = path.join(ctx.cacheDir, "ndc");
    fs.mkdirSync(work, { recursive: true });
    if (ctx.inputPath) return loadInput(ctx, work);

    let data: Buffer;
    try {
      data = await fetchBinary(NDC_ZIP_URL);
    } catch (err) {
      if (err instanceof HttpStatusError && (err.status === 404 || err.status === 403)) {
        throw new SourceNotYetAvailableError(`NDC directory is not yet available (${err.status})`);
      }
      throw err;
    }
    if (!fileSignatureOk(data, "zip")) {
      throw new Error("NDC download is not a zip");
    }
    const dest = path.join(work, "extracted");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    await extractZip(data, dest);
    const archiveCopy = path.join(work, `NDC_${ctx.archiveMonth}.zip`);
    fs.writeFileSync(archiveCopy, data);
    return {
      files: listedNdc(dest),
      rawArchivePath: archiveCopy,
      snapshot: snapshotFrom(data, ctx, NDC_ZIP_URL),
    };
  }

  async validateSource(_ctx: AdapterContext, fetched: FetchResult): Promise<void> {
    const dir = extractDir(fetched);
    for (const name of NDC_FILES) {
      if (!findFile(dir, name)) throw new Error(`Missing NDC file: ${name}`);
    }
  }

  async parse(_ctx: AdapterContext, fetched: FetchResult): Promise<NdcParsed> {
    const dir = extractDir(fetched);
    const mapping = loadMapping();
    const coverage: MappingCoverageReport = { sourceId: SOURCE_ID, fields: [], unknownFields: [] };
    const files: Record<string, Record<string, string>[]> = {};

    for (const name of NDC_FILES) {
      const fp = findFile(dir, name);
      if (!fp) continue;
      const parsed = parseTsvWithHeader(fs.readFileSync(fp, "utf8"));
      for (const header of parsed.unknownHeaders) {
        const key = `${name}.${header}`;
        if (!coverage.unknownFields.includes(key)) coverage.unknownFields.push(key);
      }
      const seen = new Map<string, number>();
      for (const row of parsed.rows) {
        for (const key of Object.keys(row)) {
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
      for (const [field, classification] of Object.entries(mapping.files[name] ?? {})) {
        coverage.fields.push({ name: `${name}.${field}`, classification, count: seen.get(field) ?? 0 });
      }
      files[name] = parsed.rows;
    }

    if (coverage.unknownFields.length > 0) {
      console.warn(`NDC unknown fields: ${coverage.unknownFields.join(", ")}`);
    }
    return { files, coverage };
  }

  async normalize(ctx: AdapterContext, parsed: unknown, snapshot: SourceSnapshot): Promise<PartialCatalogue> {
    const data = parsed as NdcParsed;
    const organizations: Organization[] = [];
    const orgByKey = new Map<string, Organization>();
    const medicinalProducts: MedicinalProduct[] = [];
    const mpById = new Map<string, MedicinalProduct>();
    const substances: Substance[] = [];
    const substanceByKey = new Map<string, Substance>();
    const authorizations: Authorization[] = [];
    const productDates = new Map<string, { start?: string; end?: string }>();
    let droppedNonHuman = 0;

    for (const row of data.files["product.txt"] ?? []) {
      const productId = row.PRODUCTID?.trim() ?? "";
      if (!productId) continue;
      const productType = row.PRODUCTTYPENAME?.trim() ?? "";
      if (isNonHuman(productType)) {
        droppedNonHuman += 1;
        continue;
      }

      const productNdc = row.PRODUCTNDC?.trim() ?? "";
      const labeler = labelerCode(productNdc);
      const labelerName = row.LABELERNAME?.trim() ?? "";
      let holder: Organization | undefined;
      if (labeler && labelerName) {
        holder = orgByKey.get(labeler);
        if (!holder) {
          holder = {
            id: canonicalId({
              jurisdiction: JURISDICTION,
              identityAuthority: AUTHORITY,
              entityType: "Organization",
              authorityKey: labeler,
            }),
            jurisdiction: JURISDICTION,
            identityAuthority: AUTHORITY,
            authorityKey: labeler,
            name: labelerName,
            role: "marketing-authorisation-holder",
            identifiers: [{ system: FDA_SYSTEMS.labeler, value: labeler, use: "official" }],
            sourceRecords: [ref(snapshot, `labeler:${labeler}`)],
          };
          orgByKey.set(labeler, holder);
          organizations.push(holder);
        }
      }

      const mpId = canonicalId({
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        entityType: "MedicinalProduct",
        authorityKey: productId,
      });
      const authId = canonicalId({
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        entityType: "Authorization",
        authorityKey: productId,
      });
      const proprietary = productTitle(row);
      const generic = row.NONPROPRIETARYNAME?.trim() ?? "";
      const names = [{ text: proprietary || generic || productNdc || productId, language: "en" }];
      if (generic && generic !== names[0]!.text) names.push({ text: generic, language: "en" });

      const category = coded(FDA_SYSTEMS.regulatoryStatus, row.MARKETINGCATEGORYNAME) ?? {
        system: FDA_SYSTEMS.regulatoryStatus,
        code: "unknown",
      };
      const built = buildIngredients(snapshot, productId, row);
      for (const substance of built.substances) {
        if (!substanceByKey.has(substance.authorityKey)) {
          substanceByKey.set(substance.authorityKey, substance);
          substances.push(substance);
        }
      }

      const mp: MedicinalProduct = {
        id: mpId,
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: productId,
        names,
        domain: medicinalProductDomain("Human"),
        doseForm: coded(FDA_SYSTEMS.doseForm, row.DOSAGEFORMNAME),
        routes: splitList(row.ROUTENAME)
          .map((route) => coded(FDA_SYSTEMS.route, route))
          .filter((value): value is CodedValue => Boolean(value)),
        regulatoryStatus: category,
        authorizationId: authId,
        identifiers: [
          ...(productNdc
            ? [{ system: FDA_SYSTEMS.productNdc, value: productNdc, use: "official" as const }]
            : []),
          { system: FDA_SYSTEMS.productId, value: productId, use: "secondary" as const },
        ],
        declarationRows: built.declarationRows,
        ingredients: built.ingredients,
        sourceRecords: [ref(snapshot, productId)],
        metadata: compactMeta({
          productTypeName: productType,
          deaSchedule: row.DEASCHEDULE,
          pharmClasses: row.PHARM_CLASSES,
          listingRecordCertifiedThrough: fdaDate(row.LISTING_RECORD_CERTIFIED_THROUGH) ?? row.LISTING_RECORD_CERTIFIED_THROUGH,
          ndcExcludeFlag: row.NDC_EXCLUDE_FLAG,
        }),
      };
      medicinalProducts.push(mp);
      mpById.set(productId, mp);
      productDates.set(productId, {
        start: fdaDate(row.STARTMARKETINGDATE),
        end: fdaDate(row.ENDMARKETINGDATE),
      });

      const application = row.APPLICATIONNUMBER?.trim() ?? "";
      authorizations.push({
        id: authId,
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: productId,
        holderId: holder?.id,
        status: category,
        medicinalProductIds: [mpId],
        identifiers: [
          ...(application ? [{ system: FDA_SYSTEMS.application, value: application, use: "official" as const }] : []),
          { system: FDA_SYSTEMS.productId, value: productId, use: "secondary" as const },
        ],
        sourceRecords: [ref(snapshot, productId)],
      });
    }

    const packages: Package[] = [];
    const pkgByCode = new Map<string, Package>();
    const startByCode = new Map<string, string>();
    const order: string[] = [];
    let unmatchedPackages = 0;

    for (const row of data.files["package.txt"] ?? []) {
      const productId = row.PRODUCTID?.trim() ?? "";
      const packageCode = row.NDCPACKAGECODE?.trim() ?? "";
      if (!packageCode) continue;
      const mp = mpById.get(productId);
      if (!mp) {
        unmatchedPackages += 1;
        continue;
      }
      const dates = productDates.get(productId);
      const start = fdaDate(row.STARTMARKETINGDATE) ?? dates?.start ?? "";
      const existingStart = startByCode.get(packageCode);
      if (existingStart !== undefined && start <= existingStart) continue;

      const end = fdaDate(row.ENDMARKETINGDATE) ?? dates?.end;
      const description = row.PACKAGEDESCRIPTION?.trim() || packageCode;
      const ndc11 = hipaaNdc11(packageCode);
      const pkg: Package = {
        id: canonicalId({
          jurisdiction: JURISDICTION,
          identityAuthority: AUTHORITY,
          entityType: "Package",
          authorityKey: packageCode,
        }),
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: packageCode,
        medicinalProductId: mp.id,
        description,
        quantity: packageQuantity(description),
        domain: medicinalProductDomain("Human"),
        regulatoryStatus: mp.regulatoryStatus,
        marketingStatus: marketingStatus(end, ctx.cutoffDate),
        names: [{ text: description, language: "en" }],
        marketingValidFrom: start || undefined,
        marketingValidTo: end,
        identifiers: [
          { system: FDA_SYSTEMS.packageNdc, value: packageCode, use: "official" },
          ...(ndc11 ? [{ system: FDA_SYSTEMS.ndc11, value: ndc11, use: "secondary" as const }] : []),
        ],
        fieldProvenance: {
          description: { sourceId: SOURCE_ID, snapshotId: snapshot.id, originalField: "PACKAGEDESCRIPTION" },
        },
        sourceRecords: [ref(snapshot, packageCode)],
        metadata: compactMeta({ samplePackage: row.SAMPLE_PACKAGE }),
      };
      if (!pkgByCode.has(packageCode)) order.push(packageCode);
      pkgByCode.set(packageCode, pkg);
      startByCode.set(packageCode, start);
    }
    for (const code of order) {
      const pkg = pkgByCode.get(code);
      if (pkg) packages.push(pkg);
    }

    data.coverage.fields.push(
      { name: "product.txt.nonHuman", classification: "intentionally-ignored", count: droppedNonHuman },
      { name: "package.txt.unmatched", classification: "intentionally-ignored", count: unmatchedPackages },
    );

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
    return (
      catalogue.mappingCoverage.find((report) => report.sourceId === SOURCE_ID) ?? {
        sourceId: SOURCE_ID,
        fields: [],
        unknownFields: [],
      }
    );
  }
}

export async function ndcDumpAvailable(): Promise<boolean> {
  return httpExists(NDC_ZIP_URL);
}

function loadMapping(): MappingFile {
  return YAML.parse(fs.readFileSync(path.join(ADAPTER_DIR, "mapping.yaml"), "utf8")) as MappingFile;
}

function snapshotFrom(buf: Buffer, ctx: AdapterContext, uri: string): SourceSnapshot {
  return {
    id: sha256(buf).slice(0, 16),
    sourceId: SOURCE_ID,
    identityAuthority: AUTHORITY,
    retrievedAt: new Date(0).toISOString(),
    sourceEffectiveDate: ctx.cutoffDate,
    sha256: sha256(buf),
    uri,
    ...snapshotTerms(loadSourceDescriptor(ADAPTER_DIR)),
  };
}

function ref(snapshot: SourceSnapshot, recordKey: string) {
  return { sourceId: SOURCE_ID, snapshotId: snapshot.id, recordKey };
}

function coded(system: string, value?: string): CodedValue | undefined {
  const display = value?.trim();
  if (!display) return undefined;
  return { system, code: fhirCode(display), display };
}

function splitList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isNonHuman(productType: string): boolean {
  return /\b(animal|veterinary|vet)\b/i.test(productType);
}

function labelerCode(productNdc: string): string | undefined {
  const segment = productNdc.split("-")[0]?.trim() ?? "";
  return /^\d+$/.test(segment) ? segment : undefined;
}

function productTitle(row: Record<string, string>): string {
  const name = row.PROPRIETARYNAME?.trim() ?? "";
  const suffix = row.PROPRIETARYNAMESUFFIX?.trim() ?? "";
  if (name && suffix) return `${name} ${suffix}`;
  return name;
}

function fdaDate(value?: string): string | undefined {
  const match = value?.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return undefined;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return undefined;
  return iso;
}

function marketingStatus(end: string | undefined, cutoffDate: string): CodedValue {
  const ended = Boolean(end && end <= cutoffDate);
  return {
    system: FDA_SYSTEMS.marketingStatus,
    code: ended ? "inactive" : "active",
    display: ended ? "Marketing ended" : "Marketed",
  };
}

const SINGLE_PACK = /^(\d+(?:\.\d+)?)\s+([A-Za-z][A-Za-z-]*)\s+in\s+\d+\b/;

function packageQuantity(description: string): PackageQuantity {
  if (description.includes("/")) return { structured: false };
  const match = description.match(SINGLE_PACK);
  if (!match) return { structured: false };
  const unit = coded(FDA_SYSTEMS.packageUnit, match[2]);
  if (!unit) return { structured: false };
  return { value: match[1], unit, structured: true };
}

function buildIngredients(
  snapshot: SourceSnapshot,
  productId: string,
  row: Record<string, string>,
): { declarationRows: DeclarationRow[]; ingredients: Ingredient[]; substances: Substance[] } {
  const names = splitList(row.SUBSTANCENAME);
  const numbers = splitList(row.ACTIVE_NUMERATOR_STRENGTH);
  const units = splitList(row.ACTIVE_INGRED_UNIT);
  const aligned = names.length > 0 && names.length === numbers.length && names.length === units.length;
  const declarationRows: DeclarationRow[] = [];
  const ingredients: Ingredient[] = [];
  const substances: Substance[] = [];

  names.forEach((name, index) => {
    const rowNo = String(index + 1);
    const substanceKey = name.replace(/\s+/g, " ").toUpperCase();
    const rowKey = authorityKey([productId, substanceKey, rowNo]);
    const rowId = canonicalId({
      jurisdiction: JURISDICTION,
      identityAuthority: AUTHORITY,
      entityType: "DeclarationRow",
      authorityKey: rowKey,
    });
    const substanceId = canonicalId({
      jurisdiction: JURISDICTION,
      identityAuthority: AUTHORITY,
      entityType: "Substance",
      authorityKey: substanceKey,
    });
    substances.push({
      id: substanceId,
      identityAuthority: AUTHORITY,
      authorityKey: substanceKey,
      name,
      identifiers: [{ system: FDA_SYSTEMS.substance, value: substanceKey }],
    });
    const strength = aligned
      ? structuredStrength(numbers[index] ?? "", units[index] ?? "")
      : {
          text: [name, row.ACTIVE_NUMERATOR_STRENGTH, row.ACTIVE_INGRED_UNIT]
            .map((part) => part?.trim())
            .filter(Boolean)
            .join(" "),
          structured: false as const,
        };
    declarationRows.push({
      id: rowId,
      componentNumber: "1",
      rowNumber: rowNo,
      rowType: "active",
      substanceId,
      substanceName: name,
      roleCode: ACTIVE_ROLE,
      quantity: strength.structured ? strength.numeratorValue : undefined,
      quantityUnit: strength.structured ? strength.numeratorUnit : undefined,
      sourceText: strength.text ?? name,
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
      role: ACTIVE_ROLE,
      strength,
    });
  });
  return { declarationRows, ingredients, substances };
}

function structuredStrength(number: string, unit: string): Strength {
  const text = [number, unit].filter(Boolean).join(" ");
  if (!/^\d+(?:\.\d+)?$/.test(number)) return { text, structured: false };
  const split = splitFdaUnit(unit);
  if (!split) {
    const numeratorUnit = coded(FDA_SYSTEMS.strengthUnit, unit);
    if (!numeratorUnit) return { text, structured: false };
    return { numeratorValue: number, numeratorUnit, text, structured: true };
  }
  return {
    numeratorValue: number,
    numeratorUnit: coded(FDA_SYSTEMS.strengthUnit, split.numeratorUnit),
    denominatorValue: split.denominatorValue,
    denominatorUnit: coded(FDA_SYSTEMS.strengthUnit, split.denominatorUnit),
    text,
    structured: true,
  };
}

function splitFdaUnit(unit: string): { numeratorUnit: string; denominatorValue: string; denominatorUnit: string } | undefined {
  const match = unit.match(/^([^/]+)\/(\d+(?:\.\d+)?)?(.*)$/);
  if (!match) return undefined;
  const numeratorUnit = match[1]!.trim();
  if (!numeratorUnit) return undefined;
  const denominatorValue = match[2] && match[2].length > 0 ? match[2] : "1";
  const denominatorUnit = match[3]!.trim() || "1";
  return { numeratorUnit, denominatorValue, denominatorUnit };
}

function compactMeta(values: Record<string, string | undefined>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const trimmed = value?.trim();
    if (trimmed) out[key] = trimmed;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseTsvWithHeader(text: string): {
  rows: Record<string, string>[];
  unknownHeaders: string[];
} {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length > 0);
  const headerLine = lines[0];
  if (!headerLine) return { rows: [], unknownHeaders: [] };
  const unknownHeaders: string[] = [];
  const headers = headerLine.split("\t").map((header) => {
    const canonical = canonicalNdcHeader(header);
    if (!canonical) {
      const raw = header.trim() || "blank";
      unknownHeaders.push(raw);
      return raw;
    }
    return canonical;
  });
  const rows = lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]!] = cells[i] ?? "";
    }
    for (let i = headers.length; i < cells.length; i++) {
      const extra = cells[i]?.trim();
      if (!extra) continue;
      const key = `col${i}`;
      row[key] = extra;
      if (!unknownHeaders.includes(key)) unknownHeaders.push(key);
    }
    return row;
  });
  return { rows, unknownHeaders };
}

async function loadInput(ctx: AdapterContext, work: string): Promise<FetchResult> {
  const input = ctx.inputPath!;
  const dest = path.join(work, "extracted");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  if (fs.statSync(input).isDirectory()) {
    for (const name of NDC_FILES) {
      const found = findFile(input, name);
      if (!found) throw new Error(`Missing NDC file in input dir: ${name}`);
      fs.copyFileSync(found, path.join(dest, name));
    }
    const files = NDC_FILES.map((name) => ({
      name,
      data: fs.readFileSync(path.join(dest, name)),
    }));
    const archiveCopy = path.join(work, `${path.basename(input)}.zip`);
    await writeDeterministicZip(files, archiveCopy);
    return {
      files: NDC_FILES.map((name) => path.join(dest, name)),
      rawArchivePath: archiveCopy,
      snapshot: snapshotFrom(fs.readFileSync(archiveCopy), ctx, `file:${input}`),
    };
  }

  const buf = fs.readFileSync(input);
  if (fileSignatureOk(buf, "zip")) {
    await extractZip(buf, dest);
    const archiveCopy = path.join(work, path.basename(input));
    fs.copyFileSync(input, archiveCopy);
    return {
      files: listedNdc(dest),
      rawArchivePath: archiveCopy,
      snapshot: snapshotFrom(buf, ctx, `file:${input}`),
    };
  }
  throw new Error("NDC input must be a zip of product.txt and package.txt or a directory containing them");
}

function listedNdc(dir: string): string[] {
  return NDC_FILES.map((name) => {
    const found = findFile(dir, name);
    if (!found) throw new Error(`Missing NDC file after extract: ${name}`);
    return found;
  });
}

function extractDir(fetched: FetchResult): string {
  const first = fetched.files[0];
  if (!first) throw new Error("No NDC files");
  return path.dirname(first);
}

function findFile(dir: string, name: string): string | undefined {
  const direct = path.join(dir, name);
  if (fs.existsSync(direct)) return direct;
  const found = fs.readdirSync(dir).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return found ? path.join(dir, found) : undefined;
}
