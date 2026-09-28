import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import YAML from "yaml";
import { authorityKey } from "../../branded.js";
import {
  OMC_SYSTEMS,
  SFDA_SYSTEMS,
  WHO_ATC_SYSTEM,
  medicinalProductDomain,
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
  type PackageUnit,
  type SourceSnapshot,
  type Strength,
  type Substance,
} from "../../canonical/types.js";
import { fhirCode } from "../../fhir/serialize.js";
import { canonicalId } from "../../identity.js";
import { repoPath } from "../../paths.js";
import { extractZip, fileSignatureOk, sha256, writeDeterministicZip } from "../../security.js";
import { loadSourceDescriptor, metadataFromDescriptor, snapshotTerms } from "../descriptor.js";
import type { Adapter, AdapterContext, AdapterMetadata, FetchResult, PartialCatalogue } from "../types.js";
import { canonicalSfdaHeader, type MappingFile, type SfdaParsed } from "./sfda-xlsx.js";

export { canonicalSfdaHeader };

const ADAPTER_DIR = repoPath("adapters/sa/sfda");
const JURISDICTION = "SA";
const AUTHORITY = "sfda";
const SOURCE_ID = "sfda";
const XLSX_NAME = "drugs-list.xlsx";
const REQUIRED_HEADERS = ["registerNumber", "tradeName", "scientificName"] as const;
const ATC_TOKEN = /^[A-Z][0-9]{2}[A-Z]{0,2}[0-9]{0,2}$/i;
const ACTIVE_ROLE: CodedValue = {
  system: SFDA_SYSTEMS.ingredientRole,
  code: "active",
  display: "Active ingredient",
};

export class SfdaAdapter implements Adapter {
  metadata(): AdapterMetadata {
    return metadataFromDescriptor(loadSourceDescriptor(ADAPTER_DIR));
  }

  async fetch(ctx: AdapterContext): Promise<FetchResult> {
    const work = path.join(ctx.cacheDir, "sfda");
    fs.mkdirSync(work, { recursive: true });
    if (!ctx.inputPath) {
      throw new Error("SFDA fetch requires --input");
    }
    return loadInput(ctx, work);
  }

  async validateSource(_ctx: AdapterContext, fetched: FetchResult): Promise<void> {
    const xlsx = findXlsx(fetched);
    if (!xlsx) throw new Error("SFDA input has no xlsx worksheet");
    const parsed = await readXlsxRows(xlsx);
    const missing = REQUIRED_HEADERS.filter((name) => !parsed.headers.includes(name));
    if (missing.length > 0) {
      throw new Error(`SFDA xlsx is missing columns: ${missing.join(", ")}`);
    }
  }

  async parse(_ctx: AdapterContext, fetched: FetchResult): Promise<SfdaParsed> {
    const xlsx = findXlsx(fetched);
    if (!xlsx) throw new Error("SFDA input has no xlsx worksheet");
    const mapping = loadMapping();
    const expected = new Set(Object.keys(mapping.files["drugs-list"] ?? {}));
    const coverage: MappingCoverageReport = { sourceId: SOURCE_ID, fields: [], unknownFields: [] };
    const sheet = await readXlsxRows(xlsx);
    const seen = new Map<string, number>();
    for (const row of sheet.rows) {
      for (const key of Object.keys(row)) {
        if (!row[key]?.trim()) continue;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    for (const header of sheet.unknownHeaders) {
      if (!coverage.unknownFields.includes(header)) coverage.unknownFields.push(header);
    }
    for (const key of seen.keys()) {
      if (!expected.has(key) && !coverage.unknownFields.includes(key)) coverage.unknownFields.push(key);
    }
    for (const [field, classification] of Object.entries(mapping.files["drugs-list"] ?? {})) {
      coverage.fields.push({ name: `drugs-list.${field}`, classification, count: seen.get(field) ?? 0 });
    }
    if (coverage.unknownFields.length > 0) {
      console.warn(`SFDA unknown fields: ${coverage.unknownFields.join(", ")}`);
    }
    return {
      rows: sheet.rows,
      originalHeaders: sheet.originalHeaders,
      coverage,
    };
  }

  async normalize(_ctx: AdapterContext, parsed: unknown, snapshot: SourceSnapshot): Promise<PartialCatalogue> {
    const data = parsed as SfdaParsed;
    const organizations: Organization[] = [];
    const orgByKey = new Map<string, Organization>();
    const medicinalProducts: MedicinalProduct[] = [];
    const mpByRegister = new Map<string, MedicinalProduct>();
    const packages: Package[] = [];
    const packageKeys = new Set<string>();
    const authorizations: Authorization[] = [];
    const authByRegister = new Map<string, Authorization>();
    const substances: Substance[] = [];
    const substanceByKey = new Map<string, Substance>();
    let skippedNonHuman = 0;
    let skippedDuplicatePackage = 0;

    for (const row of data.rows) {
      const registerNumber = row.registerNumber?.trim() ?? "";
      if (!registerNumber) continue;
      if (droppedNonHuman(row.productType)) {
        skippedNonHuman += 1;
        continue;
      }

      const holder = upsertOrg(
        orgByKey,
        organizations,
        row.marketingCompany,
        "marketing-authorisation-holder",
        snapshot,
      );
      upsertOrg(orgByKey, organizations, row.manufacturerName, "manufacturer", snapshot);
      upsertOrg(orgByKey, organizations, row.secondManufacturerName, "manufacturer", snapshot);
      upsertOrg(orgByKey, organizations, row.firstAgent, "supplier", snapshot);
      upsertOrg(orgByKey, organizations, row.secondAgent, "supplier", snapshot);
      upsertOrg(orgByKey, organizations, row.thirdAgent, "supplier", snapshot);

      const status = sourceCoded(SFDA_SYSTEMS.authorizationStatus, row.authorizationStatus) ?? {
        system: SFDA_SYSTEMS.authorizationStatus,
        code: "unknown",
      };
      const atcCodes = atcTokens(row.atcCode1, row.atcCode2);
      const gtin = gtinDigits(row.gtin);
      const existing = mpByRegister.get(registerNumber);
      const packKey = existing
        ? authorityKey([registerNumber, row.packageType?.trim() ?? "", row.packageSize?.trim() ?? ""])
        : registerNumber;
      if (packageKeys.has(packKey)) {
        skippedDuplicatePackage += 1;
        continue;
      }
      packageKeys.add(packKey);

      let mp = existing;
      let auth = authByRegister.get(registerNumber);
      if (!mp) {
        const built = buildIngredients(snapshot, registerNumber, row);
        for (const substance of built.substances) {
          if (!substanceByKey.has(substance.authorityKey)) {
            substanceByKey.set(substance.authorityKey, substance);
            substances.push(substance);
          }
        }
        const mpId = canonicalId({
          jurisdiction: JURISDICTION,
          identityAuthority: AUTHORITY,
          entityType: "MedicinalProduct",
          authorityKey: registerNumber,
        });
        const authId = canonicalId({
          jurisdiction: JURISDICTION,
          identityAuthority: AUTHORITY,
          entityType: "Authorization",
          authorityKey: registerNumber,
        });
        const names = productNames(row, registerNumber);
        mp = {
          id: mpId,
          jurisdiction: JURISDICTION,
          identityAuthority: AUTHORITY,
          authorityKey: registerNumber,
          names,
          domain: medicinalProductDomain("Human"),
          doseForm: sourceCoded(SFDA_SYSTEMS.doseForm, row.doseForm),
          routes: routesFrom(row.route),
          regulatoryStatus: status,
          authorizationId: authId,
          identifiers: [
            { system: SFDA_SYSTEMS.registerNumber, value: registerNumber, use: "official" },
            ...atcCodes.map((code) => ({ system: WHO_ATC_SYSTEM, value: code })),
          ],
          declarationRows: built.declarationRows,
          ingredients: built.ingredients,
          sourceRecords: [ref(snapshot, registerNumber)],
          metadata: compactMeta({
            registerYear: row.registerYear,
            certificateDate: row.certificateDate,
            productType: row.productType,
            drugType: row.drugType,
            scientificName: row.scientificName,
            strength: row.strength,
            strengthUnit: row.strengthUnit,
            atc: atcCodes.join(" "),
            atcCode1: row.atcCode1,
            atcCode2: row.atcCode2,
            legalStatus: row.legalStatus,
            productControl: row.productControl,
            distributionSite: row.distributionSite,
            descriptionCode: row.descriptionCode,
            marketingCompanyId: row.marketingCompanyId,
            marketingCompanyCountry: row.marketingCompanyCountry,
          }),
        };
        medicinalProducts.push(mp);
        mpByRegister.set(registerNumber, mp);
        auth = {
          id: authId,
          jurisdiction: JURISDICTION,
          identityAuthority: AUTHORITY,
          authorityKey: registerNumber,
          holderId: holder?.id,
          status,
          medicinalProductIds: [mpId],
          identifiers: [{ system: SFDA_SYSTEMS.registerNumber, value: registerNumber, use: "official" }],
          sourceRecords: [ref(snapshot, registerNumber)],
        };
        authorizations.push(auth);
        authByRegister.set(registerNumber, auth);
      }

      const description = packageDescription(row, packKey);
      const fill = row.size?.trim() ?? "";
      packages.push({
        id: canonicalId({
          jurisdiction: JURISDICTION,
          identityAuthority: AUTHORITY,
          entityType: "Package",
          authorityKey: packKey,
        }),
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: packKey,
        medicinalProductId: mp.id,
        description,
        quantity: packageQuantity(row.packageSize),
        packUnits: packFill(fill, row.sizeUnit),
        domain: medicinalProductDomain("Human"),
        packageType: sourceCoded(SFDA_SYSTEMS.packageType, row.packageType),
        regulatoryStatus: status,
        marketingStatus: sourceCoded(SFDA_SYSTEMS.marketingStatus, row.marketingStatus),
        gtin,
        names: [{ text: description, language: nameLanguage(description) }],
        identifiers: packIdentifiers(registerNumber, packKey, gtin),
        fieldProvenance: {
          description: {
            sourceId: SOURCE_ID,
            snapshotId: snapshot.id,
            originalField: data.originalHeaders.tradeName ?? "Trade Name",
          },
          packUnits: {
            sourceId: SOURCE_ID,
            snapshotId: snapshot.id,
            originalField: data.originalHeaders.size ?? "Size",
          },
        },
        sourceRecords: [ref(snapshot, packKey)],
        metadata: compactMeta({
          registerNumber,
          packageSize: row.packageSize,
          size: fill,
          sizeUnit: blankUnit(row.sizeUnit),
          legalStatus: row.legalStatus,
          productControl: row.productControl,
          distributionSite: row.distributionSite,
          price: row.price,
          priceCurrency: row.price?.trim() ? "SAR" : undefined,
          pricingDate: row.pricingDate,
          shelfLife: row.shelfLife,
          storageConditions: row.storageConditions,
          storageConditionsArabic: row.storageConditionsArabic,
          manufacturerName: row.manufacturerName,
          manufacturerCountry: row.manufacturerCountry,
          secondManufacturerName: row.secondManufacturerName,
          secondManufacturerCountry: row.secondManufacturerCountry,
          firstAgent: row.firstAgent,
          secondAgent: row.secondAgent,
          thirdAgent: row.thirdAgent,
          gtin: row.gtin,
        }),
      });
    }

    data.coverage.fields.push(
      { name: "drugs-list.nonHumanProductType", classification: "intentionally-ignored", count: skippedNonHuman },
      { name: "drugs-list.duplicatePackage", classification: "intentionally-ignored", count: skippedDuplicatePackage },
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

function droppedNonHuman(productType: string | undefined): boolean {
  const value = productType?.trim() ?? "";
  if (!value) return false;
  return value.toLowerCase() !== "human";
}

function productNames(row: Record<string, string>, fallback: string): { text: string; language: string }[] {
  const trade = row.tradeName?.trim() ?? "";
  const scientific = row.scientificName?.trim() ?? "";
  const primary = trade || scientific || fallback;
  const names = [{ text: primary, language: nameLanguage(primary) }];
  if (scientific && scientific !== primary) names.push({ text: scientific, language: nameLanguage(scientific) });
  return names;
}

function nameLanguage(text: string): string {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

function packageDescription(row: Record<string, string>, fallback: string): string {
  const trade = row.tradeName?.trim() ?? "";
  const pack = [row.packageType?.trim(), row.packageSize?.trim(), row.size?.trim(), blankUnit(row.sizeUnit)]
    .filter(Boolean)
    .join(" ");
  return [trade, pack].filter(Boolean).join(" — ") || fallback;
}

function routesFrom(value: string | undefined): CodedValue[] {
  const raw = value?.trim() ?? "";
  if (!raw) return [];
  const parts = raw.includes(",")
    ? raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : [raw];
  return parts
    .map((part) => sourceCoded(SFDA_SYSTEMS.route, part))
    .filter((coded): coded is CodedValue => Boolean(coded));
}

function sourceCoded(system: string, value?: string): CodedValue | undefined {
  const display = value?.trim();
  if (!display || display === "--") return undefined;
  if (/[\u0600-\u06FF]/.test(display)) {
    throw new Error(`SFDA coded value is Arabic with no English map: ${display}`);
  }
  return { system, code: fhirCode(display), display };
}

function blankUnit(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "--") return undefined;
  return trimmed;
}

function atcTokens(...columns: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const column of columns) {
    for (const token of (column ?? "").split(/[\s,;/]+/)) {
      const code = token.trim().toUpperCase();
      if (!ATC_TOKEN.test(code) || seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

function gtinDigits(value?: string): string | undefined {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length === 13 || digits.length === 14) return digits;
  return undefined;
}

function packIdentifiers(registerNumber: string, packKey: string, gtin: string | undefined): Package["identifiers"] {
  const identifiers: Package["identifiers"] = [
    { system: SFDA_SYSTEMS.registerNumber, value: registerNumber, use: "official" },
  ];
  if (packKey !== registerNumber) {
    identifiers.push({ system: SFDA_SYSTEMS.registerNumber, value: packKey, use: "secondary" });
  }
  if (gtin) identifiers.push({ system: OMC_SYSTEMS.gtin, value: gtin });
  return identifiers;
}

function upsertOrg(
  orgByKey: Map<string, Organization>,
  organizations: Organization[],
  name: string | undefined,
  role: Organization["role"],
  snapshot: SourceSnapshot,
): Organization | undefined {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return undefined;
  const key = `${role}|${trimmed}`;
  const existing = orgByKey.get(key);
  if (existing) return existing;
  const org: Organization = {
    id: canonicalId({
      jurisdiction: JURISDICTION,
      identityAuthority: AUTHORITY,
      entityType: "Organization",
      authorityKey: key,
    }),
    jurisdiction: JURISDICTION,
    identityAuthority: AUTHORITY,
    authorityKey: key,
    name: trimmed,
    role,
    identifiers: [{ system: SFDA_SYSTEMS.organization, value: trimmed }],
    sourceRecords: [ref(snapshot, key)],
  };
  orgByKey.set(key, org);
  organizations.push(org);
  return org;
}

function packageQuantity(packageSize: string | undefined): PackageQuantity {
  const trimmed = packageSize?.trim() ?? "";
  const match = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (!match) return { structured: false };
  return { value: match[1], structured: true };
}

function packFill(size: string, sizeUnit: string | undefined): PackageUnit[] | undefined {
  if (!size) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(size)) {
    const unit = blankUnit(sizeUnit);
    return [
      {
        capacityValue: size,
        capacityUnit: unit ? sourceCoded(SFDA_SYSTEMS.sizeUnit, unit) : undefined,
      },
    ];
  }
  return [{ additionalInfo: size }];
}

function csvParts(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((part) => part.trim());
}

function buildIngredients(
  snapshot: SourceSnapshot,
  registerNumber: string,
  row: Record<string, string>,
): { declarationRows: DeclarationRow[]; ingredients: Ingredient[]; substances: Substance[] } {
  const names = csvParts(row.scientificName).filter(Boolean);
  const numbers = csvParts(row.strength).filter(Boolean);
  const units = csvParts(row.strengthUnit).filter(Boolean);
  const unitFor = (index: number): string => (units.length === 1 ? units[0]! : (units[index] ?? ""));
  const aligned =
    names.length > 0 && names.length === numbers.length && (units.length === names.length || units.length === 1);
  const declarationRows: DeclarationRow[] = [];
  const ingredients: Ingredient[] = [];
  const substances: Substance[] = [];

  names.forEach((name, index) => {
    const rowNo = String(index + 1);
    const substanceKey = name.replace(/\s+/g, " ");
    const partKey = authorityKey([registerNumber, substanceKey, rowNo]);
    const rowId = canonicalId({
      jurisdiction: JURISDICTION,
      identityAuthority: AUTHORITY,
      entityType: "DeclarationRow",
      authorityKey: partKey,
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
      identifiers: [{ system: SFDA_SYSTEMS.substance, value: substanceKey }],
    });
    const strength = aligned
      ? structuredStrength(numbers[index] ?? "", unitFor(index))
      : {
          text: [name, row.strength, row.strengthUnit].map((part) => part?.trim()).filter(Boolean).join(" "),
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
        authorityKey: partKey,
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
  const numeratorUnit = sourceCoded(SFDA_SYSTEMS.strengthUnit, unit);
  if (!numeratorUnit) return { text, structured: false };
  const ratio = unit.match(/^([^/]+)\/(.+)$/);
  if (ratio) {
    const numUnit = sourceCoded(SFDA_SYSTEMS.strengthUnit, ratio[1]);
    const denUnit = sourceCoded(SFDA_SYSTEMS.strengthUnit, ratio[2]);
    if (numUnit && denUnit) {
      return {
        numeratorValue: number,
        numeratorUnit: numUnit,
        denominatorValue: "1",
        denominatorUnit: denUnit,
        text,
        structured: true,
      };
    }
  }
  return { numeratorValue: number, numeratorUnit, text, structured: true };
}

function compactMeta(values: Record<string, string | undefined>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const trimmed = value?.trim();
    if (trimmed) out[key] = trimmed;
  }
  return Object.keys(out).length ? out : undefined;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value.trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const rec = value as { text?: string; richText?: { text: string }[]; result?: ExcelJS.CellValue; hyperlink?: string };
    if (typeof rec.text === "string") return rec.text.trim();
    if (Array.isArray(rec.richText)) return rec.richText.map((part) => part.text).join("").trim();
    if (rec.result !== undefined) return cellText(rec.result);
    if (typeof rec.hyperlink === "string") return rec.hyperlink.trim();
  }
  return String(value).trim();
}

async function readXlsxRows(file: string): Promise<{
  rows: Record<string, string>[];
  originalHeaders: Record<string, string>;
  unknownHeaders: string[];
  headers: string[];
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("SFDA xlsx has no worksheet");
  const colCount = Math.max(sheet.columnCount, sheet.actualColumnCount, 1);
  const headerCells = rowCells(sheet.getRow(1), colCount);
  const unknownHeaders: string[] = [];
  const originalHeaders: Record<string, string> = {};
  const headers = headerCells.map((raw) => {
    if (!raw) return "";
    const canonical = canonicalSfdaHeader(raw);
    if (!canonical) {
      unknownHeaders.push(raw);
      return raw;
    }
    if (!originalHeaders[canonical]) originalHeaders[canonical] = raw;
    return canonical;
  });
  const rows: Record<string, string>[] = [];
  const lastRow = Math.max(sheet.rowCount, sheet.actualRowCount);
  for (let r = 2; r <= lastRow; r++) {
    const cells = rowCells(sheet.getRow(r), headerCells.length);
    if (cells.every((cell) => !cell)) continue;
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i];
      if (!key) continue;
      row[key] = cells[i] ?? "";
    }
    rows.push(row);
  }
  return { rows, originalHeaders, unknownHeaders, headers };
}

function rowCells(row: ExcelJS.Row, colCount: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= colCount; i++) {
    out.push(cellText(row.getCell(i).value));
  }
  return out;
}

function findXlsx(fetched: FetchResult): string | undefined {
  return fetched.files.find((file) => file.toLowerCase().endsWith(".xlsx"));
}

async function isXlsxBuffer(buf: Buffer): Promise<boolean> {
  if (!fileSignatureOk(buf, "zip")) return false;
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files).some((name) => name.startsWith("xl/"));
}

async function loadInput(ctx: AdapterContext, work: string): Promise<FetchResult> {
  const input = ctx.inputPath!;
  const dest = path.join(work, "extracted");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  if (fs.statSync(input).isDirectory()) {
    const found = fs.readdirSync(input).find((name) => name.toLowerCase().endsWith(".xlsx"));
    if (!found) throw new Error("SFDA input directory has no xlsx");
    const data = fs.readFileSync(path.join(input, found));
    const destFile = path.join(dest, XLSX_NAME);
    fs.writeFileSync(destFile, data);
    const archiveCopy = path.join(work, `${path.basename(input)}.zip`);
    await writeDeterministicZip([{ name: XLSX_NAME, data }], archiveCopy);
    return {
      files: [destFile],
      rawArchivePath: archiveCopy,
      snapshot: snapshotFrom(fs.readFileSync(archiveCopy), ctx, `file:${input}`),
    };
  }

  const buf = fs.readFileSync(input);
  if (await isXlsxBuffer(buf)) {
    const destFile = path.join(dest, XLSX_NAME);
    fs.writeFileSync(destFile, buf);
    return {
      files: [destFile],
      snapshot: snapshotFrom(buf, ctx, `file:${input}`),
    };
  }
  if (fileSignatureOk(buf, "zip")) {
    await extractZip(buf, dest);
    const xlsx = walkFiles(dest).find((file) => file.toLowerCase().endsWith(".xlsx"));
    if (!xlsx) throw new Error("SFDA zip has no xlsx");
    const archiveCopy = path.join(work, path.basename(input));
    fs.copyFileSync(input, archiveCopy);
    return {
      files: [xlsx],
      rawArchivePath: archiveCopy,
      snapshot: snapshotFrom(buf, ctx, `file:${input}`),
    };
  }
  throw new Error("SFDA input must be an xlsx, a zip containing an xlsx, or a directory of xlsx files");
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const fp = path.join(dir, name);
    if (fs.statSync(fp).isDirectory()) out.push(...walkFiles(fp));
    else out.push(fp);
  }
  return out;
}
