import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { authorityKey } from "../../branded.js";
import {
  BDPM_SYSTEMS,
  OMC_SYSTEMS,
  type Authorization,
  type Catalogue,
  type CodedValue,
  type DeclarationRow,
  type Ingredient,
  type MappingCoverageReport,
  type MedicinalProduct,
  type Organization,
  type Package,
  type Reimbursement,
  type SourceSnapshot,
  type Substance,
} from "../../canonical/types.js";
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

const ADAPTER_DIR = repoPath("adapters/fr/bdpm");
const JURISDICTION = "FR";
const AUTHORITY = "bdpm";

export const BDPM_DOWNLOAD_BASE = "https://base-donnees-publique.medicaments.gouv.fr/download/file";
export const BDPM_FILES = ["CIS_bdpm.txt", "CIS_CIP_bdpm.txt", "CIS_COMPO_bdpm.txt"] as const;

const CIS_COLUMNS = [
  "CIS",
  "denomination",
  "formePharmaceutique",
  "voiesAdministration",
  "statutAMM",
  "typeProcedure",
  "etatCommercialisation",
  "dateAMM",
  "statutBDM",
  "numeroAutorisationEuropeenne",
  "titulaire",
  "surveillanceRenforcee",
] as const;

const CIP_COLUMNS = [
  "CIS",
  "CIP7",
  "libellePresentation",
  "statutAdministratif",
  "etatCommercialisation",
  "dateCommercialisation",
  "CIP13",
  "agrementCollectivites",
  "tauxRemboursement",
  "prix",
  "prixAvecHonoraire",
  "honoraireDispensation",
  "indicationsRemboursement",
] as const;

const COMPO_COLUMNS = [
  "CIS",
  "elementPharmaceutique",
  "codeSubstance",
  "denominationSubstance",
  "dosage",
  "referenceDosage",
  "natureComposant",
  "numeroLiaison",
] as const;

const COLUMNS: Record<(typeof BDPM_FILES)[number], readonly string[]> = {
  "CIS_bdpm.txt": CIS_COLUMNS,
  "CIS_CIP_bdpm.txt": CIP_COLUMNS,
  "CIS_COMPO_bdpm.txt": COMPO_COLUMNS,
};

export function bdpmFileUrl(name: (typeof BDPM_FILES)[number]): string {
  return `${BDPM_DOWNLOAD_BASE}/${name}`;
}

interface MappingFile {
  files: Record<string, Record<string, MappingCoverageReport["fields"][number]["classification"]>>;
}

interface BdpmParsed {
  files: Record<string, Record<string, string>[]>;
  coverage: MappingCoverageReport;
}

export class BdpmAdapter implements Adapter {
  metadata(): AdapterMetadata {
    return metadataFromDescriptor(loadSourceDescriptor(ADAPTER_DIR));
  }

  async fetch(ctx: AdapterContext): Promise<FetchResult> {
    const work = path.join(ctx.cacheDir, "bdpm");
    fs.mkdirSync(work, { recursive: true });

    if (ctx.inputPath) {
      return loadInput(ctx, work);
    }

    const downloaded: { name: string; data: Buffer }[] = [];
    for (const name of BDPM_FILES) {
      const url = bdpmFileUrl(name);
      try {
        downloaded.push({ name, data: await fetchBinary(url) });
      } catch (err) {
        if (err instanceof HttpStatusError && (err.status === 404 || err.status === 403)) {
          throw new SourceNotYetAvailableError(`BDPM file ${name} is not yet available (${err.status})`);
        }
        throw err;
      }
    }

    const dest = path.join(work, "extracted");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    for (const file of downloaded) {
      fs.writeFileSync(path.join(dest, file.name), file.data);
    }
    const archiveCopy = path.join(work, `BDPM_${ctx.archiveMonth}.zip`);
    await writeDeterministicZip(downloaded, archiveCopy);
    const zipBuf = fs.readFileSync(archiveCopy);
    return {
      files: BDPM_FILES.map((name) => path.join(dest, name)),
      rawArchivePath: archiveCopy,
      snapshot: snapshotFrom(zipBuf, ctx, BDPM_DOWNLOAD_BASE),
    };
  }

  async validateSource(_ctx: AdapterContext, fetched: FetchResult): Promise<void> {
    const dir = extractDir(fetched);
    for (const name of BDPM_FILES) {
      if (!findFile(dir, name)) throw new Error(`Missing BDPM file: ${name}`);
    }
  }

  async parse(_ctx: AdapterContext, fetched: FetchResult): Promise<BdpmParsed> {
    const dir = extractDir(fetched);
    const mapping = loadMapping();
    const coverage: MappingCoverageReport = { sourceId: "bdpm", fields: [], unknownFields: [] };
    const files: Record<string, Record<string, string>[]> = {};

    for (const name of BDPM_FILES) {
      const fp = findFile(dir, name);
      if (!fp) continue;
      const columns = COLUMNS[name];
      const rows = parseTsv(decodeBdpm(fs.readFileSync(fp))).map((cells) => rowFromCells(cells, columns));
      const expected = new Set(Object.keys(mapping.files[name] ?? {}));
      const seen = new Map<string, number>();
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          seen.set(key, (seen.get(key) ?? 0) + 1);
          if (!expected.has(key) && !coverage.unknownFields.includes(`${name}.${key}`)) {
            coverage.unknownFields.push(`${name}.${key}`);
          }
        }
      }
      for (const [field, classification] of Object.entries(mapping.files[name] ?? {})) {
        coverage.fields.push({ name: `${name}.${field}`, classification, count: seen.get(field) ?? 0 });
      }
      files[name] = rows;
    }

    if (coverage.unknownFields.length > 0) {
      console.warn(`BDPM unknown fields: ${coverage.unknownFields.join(", ")}`);
    }
    return { files, coverage };
  }

  async normalize(_ctx: AdapterContext, parsed: unknown, snapshot: SourceSnapshot): Promise<PartialCatalogue> {
    const data = parsed as BdpmParsed;
    const organizations: Organization[] = [];
    const orgByKey = new Map<string, Organization>();
    const medicinalProducts: MedicinalProduct[] = [];
    const mpByCis = new Map<string, MedicinalProduct>();
    const substances: Substance[] = [];
    const substanceIds = new Set<string>();
    const authorizations: Authorization[] = [];
    const packages: Package[] = [];
    const reimbursements: Reimbursement[] = [];

    for (const row of data.files["CIS_bdpm.txt"] ?? []) {
      const cis = row.CIS?.trim() ?? "";
      if (!cis) continue;
      const holderName = (row.titulaire ?? "").trim();
      let holder: Organization | undefined;
      if (holderName) {
        const orgKey = authorityKey([holderName]);
        holder = orgByKey.get(orgKey);
        if (!holder) {
          holder = {
            id: canonicalId({
              jurisdiction: JURISDICTION,
              identityAuthority: AUTHORITY,
              entityType: "Organization",
              authorityKey: orgKey,
            }),
            jurisdiction: JURISDICTION,
            identityAuthority: AUTHORITY,
            authorityKey: orgKey,
            name: holderName,
            role: "marketing-authorisation-holder",
            identifiers: [{ system: BDPM_SYSTEMS.organization, value: holderName }],
            sourceRecords: [ref(snapshot, `titulaire:${holderName}`)],
          };
          orgByKey.set(orgKey, holder);
          organizations.push(holder);
        }
      }

      const mpId = canonicalId({
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        entityType: "MedicinalProduct",
        authorityKey: authorityKey([cis]),
      });
      const authId = canonicalId({
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        entityType: "Authorization",
        authorityKey: authorityKey([cis]),
      });
      const identifiers = [{ system: BDPM_SYSTEMS.cis, value: cis, use: "official" as const }];

      const mp: MedicinalProduct = {
        id: mpId,
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: cis,
        names: [{ text: row.denomination?.trim() || cis, language: "fr" }],
        doseForm: coded(BDPM_SYSTEMS.doseForm, row.formePharmaceutique),
        routes: splitList(row.voiesAdministration)
          .map((r) => coded(BDPM_SYSTEMS.route, r))
          .filter((c): c is CodedValue => Boolean(c)),
        regulatoryStatus: coded(BDPM_SYSTEMS.regulatoryStatus, row.statutAMM) ?? {
          system: BDPM_SYSTEMS.regulatoryStatus,
          code: "unknown",
        },
        authorizationId: authId,
        identifiers,
        declarationRows: [],
        ingredients: [],
        sourceRecords: [ref(snapshot, cis)],
        metadata: compactMeta({
          typeProcedure: row.typeProcedure,
          etatCommercialisation: row.etatCommercialisation,
          dateAMM: frenchDate(row.dateAMM),
          statutBDM: row.statutBDM,
          numeroAutorisationEuropeenne: row.numeroAutorisationEuropeenne,
          surveillanceRenforcee: row.surveillanceRenforcee,
        }),
      };
      medicinalProducts.push(mp);
      mpByCis.set(cis, mp);

      authorizations.push({
        id: authId,
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: cis,
        holderId: holder?.id,
        status: coded(BDPM_SYSTEMS.regulatoryStatus, row.statutAMM) ?? {
          system: BDPM_SYSTEMS.regulatoryStatus,
          code: "unknown",
        },
        medicinalProductIds: [mpId],
        identifiers: [{ system: BDPM_SYSTEMS.cis, value: cis }],
        sourceRecords: [ref(snapshot, cis)],
      });
    }

    const compoByCis = new Map<string, Record<string, string>[]>();
    for (const row of data.files["CIS_COMPO_bdpm.txt"] ?? []) {
      const cis = row.CIS?.trim() ?? "";
      if (!cis) continue;
      const list = compoByCis.get(cis) ?? [];
      list.push(row);
      compoByCis.set(cis, list);
    }

    for (const [cis, rows] of compoByCis) {
      const mp = mpByCis.get(cis);
      if (!mp) continue;
      const built = buildComposition(snapshot, cis, rows);
      mp.declarationRows = built.declarationRows;
      mp.ingredients = built.ingredients;
      for (const s of built.substances) {
        if (!substanceIds.has(s.id)) {
          substanceIds.add(s.id);
          substances.push(s);
        }
      }
    }

    for (const row of data.files["CIS_CIP_bdpm.txt"] ?? []) {
      const cis = row.CIS?.trim() ?? "";
      const cip13 = row.CIP13?.trim() ?? "";
      const cip7 = row.CIP7?.trim() ?? "";
      const packKey = cip13 || cip7;
      if (!cis || !packKey) continue;
      const mp = mpByCis.get(cis);
      if (!mp) continue;

      const pkgId = canonicalId({
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        entityType: "Package",
        authorityKey: authorityKey([packKey]),
      });
      const identifiers = [];
      if (cip13) identifiers.push({ system: BDPM_SYSTEMS.cip, value: cip13, use: "official" as const });
      if (cip7) identifiers.push({ system: BDPM_SYSTEMS.cip7, value: cip7, use: "usual" as const });
      const gtin = /^\d{13}$/.test(cip13) ? cip13 : undefined;
      if (gtin) identifiers.push({ system: OMC_SYSTEMS.gtin, value: gtin });

      const agrement = row.agrementCollectivites?.trim().toLowerCase();
      const pkg: Package = {
        id: pkgId,
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: packKey,
        medicinalProductId: mp.id,
        description: row.libellePresentation?.trim() || packKey,
        quantity: { structured: false },
        regulatoryStatus: coded(BDPM_SYSTEMS.regulatoryStatus, row.statutAdministratif) ?? {
          system: BDPM_SYSTEMS.regulatoryStatus,
          code: "unknown",
        },
        marketingStatus: coded(BDPM_SYSTEMS.marketingStatus, row.etatCommercialisation),
        reimbursementStatus: agrement ? coded(BDPM_SYSTEMS.collectivites, agrement) : undefined,
        gtin,
        names: row.libellePresentation?.trim()
          ? [{ text: row.libellePresentation.trim(), language: "fr" }]
          : undefined,
        marketingValidFrom: frenchDate(row.dateCommercialisation),
        identifiers,
        fieldProvenance: {
          description: { sourceId: "bdpm", snapshotId: snapshot.id, originalField: "libellePresentation" },
        },
        sourceRecords: [ref(snapshot, packKey)],
        metadata: compactMeta({
          CIP7: cip7,
          agrementCollectivites: row.agrementCollectivites,
          prixAvecHonoraire: row.prixAvecHonoraire,
          honoraireDispensation: row.honoraireDispensation,
        }),
      };
      packages.push(pkg);

      const rates = parseRates(row.tauxRemboursement, stripHtml(row.indicationsRemboursement));
      const prix = row.prix?.trim();
      if (rates.length || prix || agrement) {
        reimbursements.push({
          packageId: pkgId,
          status: coded(BDPM_SYSTEMS.collectivites, agrement || "inconnu") ?? {
            system: BDPM_SYSTEMS.collectivites,
            code: "inconnu",
          },
          price: prix ? { value: prix, currency: "EUR" } : undefined,
          prices: prix ? [{ value: prix, currency: "EUR" }] : undefined,
          rates: rates.length ? rates : undefined,
          limitations: stripHtml(row.indicationsRemboursement) || undefined,
          fieldProvenance: { sourceId: "bdpm", snapshotId: snapshot.id, originalField: "tauxRemboursement" },
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
      reimbursements,
      sourceSnapshots: [snapshot],
      mappingCoverage: [data.coverage],
    };
  }

  qualityReport(catalogue: Catalogue, _snapshot: SourceSnapshot): MappingCoverageReport {
    return catalogue.mappingCoverage.find((m) => m.sourceId === "bdpm") ?? {
      sourceId: "bdpm",
      fields: [],
      unknownFields: [],
    };
  }
}

export async function bdpmDumpAvailable(): Promise<boolean> {
  return httpExists(bdpmFileUrl("CIS_bdpm.txt"));
}

function loadMapping(): MappingFile {
  return YAML.parse(fs.readFileSync(path.join(ADAPTER_DIR, "mapping.yaml"), "utf8")) as MappingFile;
}

function snapshotFrom(buf: Buffer, ctx: AdapterContext, uri: string): SourceSnapshot {
  return {
    id: sha256(buf).slice(0, 16),
    sourceId: "bdpm",
    identityAuthority: AUTHORITY,
    retrievedAt: new Date(0).toISOString(),
    sourceEffectiveDate: ctx.cutoffDate,
    sha256: sha256(buf),
    uri,
    ...snapshotTerms(loadSourceDescriptor(ADAPTER_DIR)),
  };
}

function ref(snapshot: SourceSnapshot, recordKey: string) {
  return { sourceId: "bdpm", snapshotId: snapshot.id, recordKey };
}

function coded(system: string, value?: string): CodedValue | undefined {
  const code = value?.trim();
  if (!code) return undefined;
  return { system, code, display: code };
}

function splitList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/[;]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function frenchDate(value?: string): string | undefined {
  const m = value?.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function stripHtml(value?: string): string {
  if (!value) return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRates(taux?: string, indications?: string): { rate: string; indications?: string }[] {
  const parts = (taux ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  return parts.map((rate) => (indications ? { rate, indications } : { rate }));
}

function compactMeta(values: Record<string, string | undefined>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    const t = v?.trim();
    if (t) out[k] = t;
  }
  return Object.keys(out).length ? out : undefined;
}

function decodeBdpm(buf: Buffer): string {
  const utf8 = buf.toString("utf8");
  if (Buffer.from(utf8, "utf8").equals(buf)) return utf8;
  return buf.toString("latin1");
}

function parseTsv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => (line.includes("\t") ? line.split("\t") : line.split(";")));
}

function rowFromCells(cells: string[], columns: readonly string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (let i = 0; i < columns.length; i++) {
    row[columns[i]!] = cells[i] ?? "";
  }
  for (let i = columns.length; i < cells.length; i++) {
    const extra = cells[i]?.trim();
    if (extra) row[`col${i}`] = extra;
  }
  return row;
}

function buildComposition(
  snapshot: SourceSnapshot,
  cis: string,
  rows: Record<string, string>[],
): { declarationRows: DeclarationRow[]; ingredients: Ingredient[]; substances: Substance[] } {
  const declarationRows: DeclarationRow[] = [];
  const ingredients: Ingredient[] = [];
  const substances: Substance[] = [];
  rows.forEach((row, index) => {
    const substCode = row.codeSubstance?.trim() ?? "";
    const name = row.denominationSubstance?.trim() || substCode || "unknown";
    const rowNo = String(index + 1);
    const link = row.numeroLiaison?.trim() || rowNo;
    const rowKey = authorityKey([cis, substCode || name, link, rowNo]);
    const rowId = canonicalId({
      jurisdiction: JURISDICTION,
      identityAuthority: AUTHORITY,
      entityType: "DeclarationRow",
      authorityKey: rowKey,
    });
    let substanceId: DeclarationRow["substanceId"];
    if (substCode) {
      const sid = canonicalId({
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        entityType: "Substance",
        authorityKey: authorityKey([substCode]),
      });
      substanceId = sid;
      substances.push({
        id: sid,
        identityAuthority: AUTHORITY,
        authorityKey: substCode,
        name,
        identifiers: [{ system: BDPM_SYSTEMS.substance, value: substCode }],
      });
    }
    const role = coded(BDPM_SYSTEMS.ingredientRole, row.natureComposant);
    const sourceText = [name, row.dosage, row.referenceDosage].filter(Boolean).join(" ");
    declarationRows.push({
      id: rowId,
      componentNumber: row.elementPharmaceutique || "1",
      componentName: row.elementPharmaceutique,
      rowNumber: rowNo,
      sortOrder: link,
      rowType: row.natureComposant || "SA",
      substanceId,
      sourceSubstanceId: substCode || undefined,
      substanceName: name,
      roleCode: role,
      quantity: row.dosage,
      sourceText,
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
      role: role ?? { system: BDPM_SYSTEMS.ingredientRole, code: "unknown" },
      strength: { text: sourceText, structured: false },
    });
  });
  return { declarationRows, ingredients, substances };
}

async function loadInput(ctx: AdapterContext, work: string): Promise<FetchResult> {
  const input = ctx.inputPath!;
  const dest = path.join(work, "extracted");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  if (fs.statSync(input).isDirectory()) {
    for (const name of BDPM_FILES) {
      const found = findFile(input, name);
      if (!found) throw new Error(`Missing BDPM file in input dir: ${name}`);
      fs.copyFileSync(found, path.join(dest, name));
    }
    const files = BDPM_FILES.map((name) => ({
      name,
      data: fs.readFileSync(path.join(dest, name)),
    }));
    const archiveCopy = path.join(work, path.basename(input) + ".zip");
    await writeDeterministicZip(files, archiveCopy);
    return {
      files: BDPM_FILES.map((name) => path.join(dest, name)),
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
      files: listedBdpm(dest),
      rawArchivePath: archiveCopy,
      snapshot: snapshotFrom(buf, ctx, `file:${input}`),
    };
  }
  throw new Error("BDPM input must be a zip of CIS/CIP/COMPO txt files or a directory containing them");
}

function listedBdpm(dir: string): string[] {
  return BDPM_FILES.map((name) => {
    const found = findFile(dir, name);
    if (!found) throw new Error(`Missing BDPM file after extract: ${name}`);
    return found;
  });
}

function extractDir(fetched: FetchResult): string {
  const first = fetched.files[0];
  if (!first) throw new Error("No BDPM files");
  return path.dirname(first);
}

function findFile(dir: string, name: string): string | undefined {
  const direct = path.join(dir, name);
  if (fs.existsSync(direct)) return direct;
  const found = fs.readdirSync(dir).find((f) => f.toLowerCase() === name.toLowerCase());
  return found ? path.join(dir, found) : undefined;
}
