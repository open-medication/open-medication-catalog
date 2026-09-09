import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  asAuthorisationNumber,
  asPackageCode,
  asSequenceNumber,
  authorityKey,
} from "../../branded.js";
import {
  type Authorization,
  type Catalogue,
  type CodedValue,
  type DeclarationRow,
  type Ingredient,
  type MappingCoverageReport,
  type MedicinalProduct,
  type Organization,
  type Package,
  type ProductGroup,
  SWISSMEDIC_SYSTEMS,
  type SourceSnapshot,
  type Substance,
} from "../../canonical/types.js";
import { canonicalId } from "../../identity.js";
import { repoPath } from "../../paths.js";
import { HttpStatusError, extractZip, fetchBinary, fileSignatureOk, sha256 } from "../../security.js";
import { asArray, optionalText, parseXmlFile, text } from "../../xml.js";
import { loadSourceDescriptor, metadataFromDescriptor, snapshotTerms } from "../descriptor.js";
import type { Adapter, AdapterContext, AdapterMetadata, FetchResult, PartialCatalogue } from "../types.js";

const ADAPTER_DIR = repoPath("adapters/ch/swissmedic");
const JURISDICTION = "CH";
const AUTHORITY = "swissmedic";

const FILE_MAP = {
  praeparate: "OGD-Praeparate.XML",
  sequenzen: "OGD-Sequenzen.XML",
  packungen: "OGD-Packungen.XML",
  deklarationen: "OGD-Deklarationen.XML",
  adressen: "OGD-Adressen.XML",
  udc: "OGD-User-Defined-Codes.XML",
  export: "OGD-Export-Datum.XML",
  atc: "OGD-ATC-Codes.XML",
  routes: "OGD-Applikationsarten pro Sequenz.XML",
  synonyms: "OGD-Stoff-Synonyme.XML",
} as const;

interface UdcKey {
  table: string;
  code: string;
  lang: string;
}

export class SwissmedicAdapter implements Adapter {
  metadata(): AdapterMetadata {
    return metadataFromDescriptor(loadSourceDescriptor(ADAPTER_DIR));
  }

  async fetch(ctx: AdapterContext): Promise<FetchResult> {
    const work = path.join(ctx.cacheDir, "swissmedic");
    fs.mkdirSync(work, { recursive: true });

    if (ctx.inputPath) {
      const buf = fs.readFileSync(ctx.inputPath);
      if (!fileSignatureOk(buf, "zip")) throw new Error("Swissmedic input is not a ZIP");
      const dest = path.join(work, "extracted");
      fs.rmSync(dest, { recursive: true, force: true });
      await extractZip(buf, dest);
      const archiveCopy = path.join(work, path.basename(ctx.inputPath));
      fs.copyFileSync(ctx.inputPath, archiveCopy);
      return {
        files: listXml(dest),
        rawArchivePath: archiveCopy,
        snapshot: snapshotFrom(buf, ctx, `file:${ctx.inputPath}`),
      };
    }

    const candidates = swissmedicArchiveCandidates(ctx.archiveMonth);
    let buf: Buffer | undefined;
    let uri = candidates[0]!.url;
    let lastMissing: HttpStatusError | undefined;
    for (const candidate of candidates) {
      try {
        buf = await fetchBinary(candidate.url);
        uri = candidate.url;
        break;
      } catch (err) {
        if (err instanceof HttpStatusError && (err.status === 404 || err.status === 403)) {
          lastMissing = err;
          continue;
        }
        throw err;
      }
    }
    if (!buf) {
      const names = candidates.map((c) => c.name).join(" / ");
      throw new SourceNotYetAvailableError(
        `Swissmedic archive ${names} is not yet available (${lastMissing?.status ?? "missing"})`,
      );
    }
    if (!fileSignatureOk(buf, "zip")) throw new Error("Swissmedic archive is not a ZIP");
    const archiveName = path.basename(uri);
    const archiveCopy = path.join(work, archiveName);
    fs.writeFileSync(archiveCopy, buf);
    const dest = path.join(work, "extracted");
    fs.rmSync(dest, { recursive: true, force: true });
    await extractZip(buf, dest);
    return {
      files: listXml(dest),
      rawArchivePath: archiveCopy,
      snapshot: snapshotFrom(buf, ctx, uri),
    };
  }

  async validateSource(_ctx: AdapterContext, fetched: FetchResult): Promise<void> {
    const dir = extractDir(fetched);
    for (const name of Object.values(FILE_MAP)) {
      const p = findXml(dir, name);
      if (!p) throw new Error(`Missing Swissmedic XML file: ${name}`);
    }
    const xsdDir = path.join(ADAPTER_DIR, "xsd");
    if (hasXmllint()) {
      const pairs: [string, string][] = [
        [FILE_MAP.praeparate, "OGD-Praeparate.xsd"],
        [FILE_MAP.sequenzen, "OGD-Sequenzen.xsd"],
        [FILE_MAP.packungen, "OGD-Packungen.xsd"],
        [FILE_MAP.deklarationen, "OGD-Deklarationen.xsd"],
        [FILE_MAP.adressen, "OGD-Adressen.xsd"],
        [FILE_MAP.udc, "OGD-User-Defined-Codes.xsd"],
        [FILE_MAP.export, "OGD-Export-Datum.xsd"],
        [FILE_MAP.atc, "OGD-ATC-Codes.xsd"],
        [FILE_MAP.routes, "OGD-Applikationsarten_pro_Sequenz.xsd"],
        [FILE_MAP.synonyms, "OGD-Stoff-Synonyme.xsd"],
      ];
      for (const [xmlName, xsdName] of pairs) {
        const xml = findXml(dir, xmlName);
        const xsd = path.join(xsdDir, xsdName);
        if (xml && fs.existsSync(xsd)) {
          try {
            execFileSync("xmllint", ["--nonet", "--noout", "--schema", xsd, xml], {
              stdio: ["ignore", "pipe", "pipe"],
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("failed to compile")) {
              console.warn(`Swissmedic XSD ${xsdName} failed to compile (upstream type names); checking well-formedness only`);
              execFileSync("xmllint", ["--nonet", "--noout", xml], { stdio: ["ignore", "pipe", "pipe"] });
            } else {
              throw err;
            }
          }
        }
      }
    }
  }

  async parse(_ctx: AdapterContext, fetched: FetchResult): Promise<SwissmedicParsed> {
    const dir = extractDir(fetched);
    const mapping = loadMapping();
    const files: Record<string, Record<string, unknown>[]> = {};
    const coverage: MappingCoverageReport = {
      sourceId: "swissmedic",
      fields: [],
      unknownFields: [],
    };

    const parseNamed = (logical: keyof typeof FILE_MAP, rowTag: string) => {
      const fileName = FILE_MAP[logical];
      const fp = findXml(dir, fileName);
      if (!fp) return [];
      const doc = parseXmlFile(fp) as Record<string, unknown>;
      const rows = findRows(doc, rowTag);
      const expected = new Set(Object.keys(mapping.files[fileName] ?? {}));
      const seen = new Map<string, number>();
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          if (key.startsWith("@") || key.startsWith("?")) continue;
          seen.set(key, (seen.get(key) ?? 0) + 1);
          if (!expected.has(key) && !coverage.unknownFields.includes(key)) {
            coverage.unknownFields.push(key);
          }
        }
      }
      for (const [name, classification] of Object.entries(mapping.files[fileName] ?? {})) {
        coverage.fields.push({ name: `${fileName}.${name}`, classification, count: seen.get(name) ?? 0 });
      }
      files[logical] = rows;
      return rows;
    };

    parseNamed("praeparate", "PRAEPARAT");
    parseNamed("sequenzen", "SEQUENZ");
    parseNamed("packungen", "PACKUNG");
    parseNamed("deklarationen", "DEKLARATION");
    parseNamed("adressen", "ADRESSEN");
    parseNamed("udc", "UDC");
    parseNamed("export", "DATUM");
    parseNamed("atc", "ATC");
    parseNamed("routes", "APPLIKATIONSART");
    parseNamed("synonyms", "SYNONYME");

    if (coverage.unknownFields.length > 0) {
      console.warn(`Swissmedic unknown fields: ${coverage.unknownFields.join(", ")}`);
    }

    const exportDate = optionalText(files.export?.[0]?.EXPORT_DATUM);
    return { files, coverage, exportDate };
  }

  async normalize(
    ctx: AdapterContext,
    parsed: unknown,
    snapshot: SourceSnapshot,
  ): Promise<PartialCatalogue> {
    const data = parsed as SwissmedicParsed;
    if (data.exportDate) snapshot.sourceEffectiveDate = data.exportDate;

    const udc = indexUdc(data.files.udc ?? []);
    const atcDesc = new Map<string, string>();
    for (const row of data.files.atc ?? []) {
      atcDesc.set(text(row.ATC_CODE), text(row.ATC_INDIKATIONS_BESCHREIBUNG));
    }
    const synonyms = new Map<string, string>();
    for (const row of data.files.synonyms ?? []) {
      const id = text(row.STOFF_ID);
      if (id && !synonyms.has(id)) synonyms.set(id, text(row.STOFFSYNONYM));
    }

    const organizations: Organization[] = [];
    for (const row of data.files.adressen ?? []) {
      const partner = text(row.PARTNER_NR);
      if (!partner) continue;
      const id = canonicalId({
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        entityType: "Organization",
        authorityKey: authorityKey([partner]),
      });
      organizations.push({
        id,
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: partner,
        name: text(row.FIRMENNAME),
        role: "marketing-authorisation-holder",
        identifiers: [{ system: SWISSMEDIC_SYSTEMS.organization, value: partner }],
        sourceRecords: [ref(snapshot, partner)],
      });
    }
    const orgByPartner = new Map(organizations.map((o) => [o.authorityKey, o]));

    const humanAuth = new Set<string>();
    const productGroups: ProductGroup[] = [];
    for (const row of data.files.praeparate ?? []) {
      if (text(row.VERWENDUNG) !== "HAM") continue;
      const authNo = asAuthorisationNumber(text(row.ZULASSUNGSNUMMER));
      humanAuth.add(authNo);
      const holder = optionalText(row.ZULASSUNGSINHABERIN);
      const atcCode = optionalText(row.ATC_CODE);
      productGroups.push({
        id: canonicalId({
          jurisdiction: JURISDICTION,
          identityAuthority: AUTHORITY,
          entityType: "ProductGroup",
          authorityKey: authorityKey([authNo]),
        }),
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: authNo,
        names: [{ text: text(row.PRAEPARATENAME), language: "de" }],
        atc: atcCode
          ? { system: "http://www.whocc.no/atc", code: atcCode, display: atcDesc.get(atcCode) }
          : undefined,
        regulatoryStatus: coded(SWISSMEDIC_SYSTEMS.regulatoryStatus, text(row.ZULASSUNGSSTATUS), udc, "MA_STATUS"),
        authorizationHolderId: holder ? orgByPartner.get(holder)?.id : undefined,
        validityStart: optionalText(row.ERSTZULASSUNGSDATUM),
        validityEnd: emptyDate(optionalText(row.ABLAUFDATUM)),
        identifiers: [{ system: SWISSMEDIC_SYSTEMS.authorisation, value: authNo }],
        sourceRecords: [ref(snapshot, authNo)],
        metadata: {
          heilmittelCode: text(row.HEILMITTEL_CODE),
          zulassungskategorie: text(row.ZULASSUNGSKATEGORIE),
          abgabekategorie: text(row.ABGABEKATEGORIE),
        },
      });
    }
    const groupByAuth = new Map(productGroups.map((g) => [g.authorityKey, g]));

    const routesBySeq = new Map<string, CodedValue[]>();
    for (const row of data.files.routes ?? []) {
      const authNo = text(row.ZULASSUNGSNUMMER);
      const seq = text(row.SEQUENZNUMMER);
      if (!humanAuth.has(authNo)) continue;
      const code = text(row.APPLIKATIONSART_CODE);
      const list = routesBySeq.get(`${authNo}|${seq}`) ?? [];
      list.push(coded(SWISSMEDIC_SYSTEMS.route, code, udc, "ROUTE_ADMIN"));
      routesBySeq.set(`${authNo}|${seq}`, list);
    }

    const declBySeq = new Map<string, Record<string, unknown>[]>();
    for (const row of data.files.deklarationen ?? []) {
      const authNo = text(row.ZULASSUNGSNUMMER);
      if (!humanAuth.has(authNo)) continue;
      const key = `${authNo}|${text(row.SEQUENZNUMMER)}`;
      const list = declBySeq.get(key) ?? [];
      list.push(row);
      declBySeq.set(key, list);
    }

    const substances: Substance[] = [];
    const substanceIds = new Set<string>();
    const medicinalProducts: MedicinalProduct[] = [];
    const authProducts = new Map<string, string[]>();

    for (const row of data.files.sequenzen ?? []) {
      const authNo = asAuthorisationNumber(text(row.ZULASSUNGSNUMMER));
      if (!humanAuth.has(authNo)) continue;
      const seq = asSequenceNumber(text(row.SEQUENZNUMMER));
      const group = groupByAuth.get(authNo);
      const key = `${authNo}|${seq}`;
      const mpId = canonicalId({
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        entityType: "MedicinalProduct",
        authorityKey: authorityKey([authNo, seq]),
      });
      const { declarationRows, ingredients, newSubstances } = buildDeclaration(
        snapshot,
        authNo,
        seq,
        declBySeq.get(key) ?? [],
        synonyms,
        udc,
      );
      for (const s of newSubstances) {
        if (!substanceIds.has(s.id)) {
          substanceIds.add(s.id);
          substances.push(s);
        }
      }
      medicinalProducts.push({
        id: mpId,
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: `${authNo}|${seq}`,
        productGroupId: group?.id,
        names: [{ text: text(row.SEQUENZNAME) || group?.names[0]?.text || "", language: "de" }],
        doseForm: undefined,
        routes: routesBySeq.get(key) ?? [],
        regulatoryStatus: coded(SWISSMEDIC_SYSTEMS.regulatoryStatus, text(row.ZULASSUNGSSTATUS), udc, "MA_STATUS"),
        identifiers: [
          { system: SWISSMEDIC_SYSTEMS.authorisation, value: authNo },
          { system: SWISSMEDIC_SYSTEMS.sequence, value: `${authNo}|${seq}` },
        ],
        declarationRows,
        ingredients,
        sourceRecords: [ref(snapshot, key)],
        metadata: {
          zulassungsart: text(row.ZULASSUNGSART),
          widerruf: text(row.WIDERRUF_VERZICHT_DATUM),
        },
      });
      const list = authProducts.get(authNo) ?? [];
      list.push(mpId);
      authProducts.set(authNo, list);
    }

    // Fix dose form properly (avoid the messy ternary above) — recompute from praeparate.
    const formByAuth = new Map<string, string>();
    for (const row of data.files.praeparate ?? []) {
      if (text(row.VERWENDUNG) === "HAM") {
        formByAuth.set(text(row.ZULASSUNGSNUMMER), text(row.ARZNEIFORM));
      }
    }
    for (const mp of medicinalProducts) {
      const authNo = mp.authorityKey.split("|")[0]!;
      const form = formByAuth.get(authNo);
      mp.doseForm = form ? coded(SWISSMEDIC_SYSTEMS.doseForm, form, udc, "DF") : undefined;
    }

    const packages: Package[] = [];
    for (const row of data.files.packungen ?? []) {
      const authNo = asAuthorisationNumber(text(row.ZULASSUNGSNUMMER));
      if (!humanAuth.has(authNo)) continue;
      const seq = asSequenceNumber(text(row.SEQUENZNUMMER));
      const pack = asPackageCode(text(row.PACKUNGSCODE));
      const mp = medicinalProducts.find((p) => p.authorityKey === `${authNo}|${seq}`);
      if (!mp) continue;
      const size = optionalText(row.PACKUNGSGROESSE);
      const unitCode = optionalText(row.PACKUNGSEINHEIT);
      const unit = unitCode ? coded(SWISSMEDIC_SYSTEMS.packageUnit, unitCode, udc, "PACKAGE_UNIT") : undefined;
      const free = optionalText(row.BEMERKUNG_FREITEXT) ?? "";
      const description = packDescription(pack, size, unit?.display ?? unitCode, free);
      const weird = /[×xX]\s*\d/.test(free) || /\d+\s*[x×]\s*\d/.test(free);
      packages.push({
        id: canonicalId({
          jurisdiction: JURISDICTION,
          identityAuthority: AUTHORITY,
          entityType: "Package",
          authorityKey: authorityKey([authNo, seq, pack]),
        }),
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: `${authNo}|${seq}|${pack}`,
        medicinalProductId: mp.id,
        productGroupId: mp.productGroupId,
        description,
        quantity: {
          value: !weird ? size : undefined,
          unit: !weird ? unit : undefined,
          structured: Boolean(!weird && size && unitCode && /^\d+([.,]\d+)?$/.test(size)),
        },
        packageType: optionalText(row.PACKUNGSTYP)
          ? coded(SWISSMEDIC_SYSTEMS.packageUnit, text(row.PACKUNGSTYP), udc, "PAC_TYPE")
          : undefined,
        regulatoryStatus: coded(SWISSMEDIC_SYSTEMS.regulatoryStatus, text(row.ZULASSUNGSSTATUS), udc, "MA_STATUS"),
        identifiers: [
          { system: SWISSMEDIC_SYSTEMS.package, value: `${authNo}|${seq}|${pack}` },
          { system: SWISSMEDIC_SYSTEMS.authorisation, value: authNo },
        ],
        fieldProvenance: {
          description: { sourceId: "swissmedic", snapshotId: snapshot.id, originalField: "BEMERKUNG_FREITEXT" },
        },
        sourceRecords: [ref(snapshot, `${authNo}|${seq}|${pack}`)],
        metadata: {
          packCode: pack,
          abgabekategorie: text(row.ABGABEKATEGORIE),
          btm: text(row.BTM_CODE),
        },
      });
    }

    const authorizations: Authorization[] = [];
    for (const group of productGroups) {
      const mpIds = authProducts.get(group.authorityKey) ?? [];
      authorizations.push({
        id: canonicalId({
          jurisdiction: JURISDICTION,
          identityAuthority: AUTHORITY,
          entityType: "Authorization",
          authorityKey: authorityKey([group.authorityKey]),
        }),
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        authorityKey: group.authorityKey,
        holderId: group.authorizationHolderId,
        status: group.regulatoryStatus,
        medicinalProductIds: mpIds as Authorization["medicinalProductIds"],
        identifiers: [{ system: SWISSMEDIC_SYSTEMS.authorisation, value: group.authorityKey }],
        sourceRecords: [ref(snapshot, group.authorityKey)],
      });
    }
    const authByGroup = new Map(authorizations.map((a) => [a.authorityKey, a]));
    for (const mp of medicinalProducts) {
      const authNo = mp.authorityKey.split("|")[0]!;
      mp.authorizationId = authByGroup.get(authNo)?.id;
    }

    return {
      productGroups,
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
    return catalogue.mappingCoverage.find((m) => m.sourceId === "swissmedic") ?? {
      sourceId: "swissmedic",
      fields: [],
      unknownFields: [],
    };
  }
}

export class SourceNotYetAvailableError extends Error {
  readonly notYetAvailable = true;
}

/** Swissmedic's docs use `.ZIP`; the live archive directory uses `.zip`. Try both. */
export function swissmedicArchiveCandidates(archiveMonth: string): { name: string; url: string }[] {
  return [".zip", ".ZIP"].map((ext) => {
    const name = `OGD_${archiveMonth}${ext}`;
    return { name, url: `https://ogd.swissmedic.cloud/ogd-arzneimittel/Archiv/${name}` };
  });
}

export function assertPackageCodeUniqueWithinAuth(packages: Package[]): void {
  const map = new Map<string, Set<string>>();
  for (const pkg of packages) {
    const [auth, seq, pack] = pkg.authorityKey.split("|");
    if (!auth || !seq || !pack) continue;
    const key = `${auth}|${pack}`;
    const set = map.get(key) ?? new Set();
    set.add(seq);
    map.set(key, set);
  }
  const collisions = [...map.entries()].filter(([, seqs]) => seqs.size > 1);
  if (collisions.length > 0) {
    throw new Error(
      `Refdata join invariant failed: ${collisions.length} authorisation+packageCode values map to multiple sequences`,
    );
  }
}

interface SwissmedicParsed {
  files: Record<string, Record<string, unknown>[]>;
  coverage: MappingCoverageReport;
  exportDate?: string;
}

interface MappingFile {
  files: Record<string, Record<string, MappingCoverageReport["fields"][number]["classification"]>>;
}

function loadMapping(): MappingFile {
  return YAML.parse(fs.readFileSync(path.join(ADAPTER_DIR, "mapping.yaml"), "utf8")) as MappingFile;
}

function listXml(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".xml")).map((f) => path.join(dir, f));
}

function findXml(dir: string, name: string): string | undefined {
  const direct = path.join(dir, name);
  if (fs.existsSync(direct)) return direct;
  const found = fs.readdirSync(dir).find((f) => f.toLowerCase() === name.toLowerCase());
  return found ? path.join(dir, found) : undefined;
}

function extractDir(fetched: FetchResult): string {
  const first = fetched.files[0];
  if (!first) throw new Error("No Swissmedic XML files");
  return path.dirname(first);
}

function findRows(doc: Record<string, unknown>, tag: string): Record<string, unknown>[] {
  const walk = (node: unknown): Record<string, unknown>[] => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(walk);
    const rec = node as Record<string, unknown>;
    if (tag in rec) return asArray(rec[tag]) as Record<string, unknown>[];
    return Object.values(rec).flatMap(walk);
  };
  return walk(doc);
}

function snapshotFrom(buf: Buffer, ctx: AdapterContext, uri: string): SourceSnapshot {
  return {
    id: sha256(buf).slice(0, 16),
    sourceId: "swissmedic",
    identityAuthority: AUTHORITY,
    retrievedAt: new Date(0).toISOString(),
    sourceEffectiveDate: ctx.cutoffDate,
    sha256: sha256(buf),
    uri,
    ...snapshotTerms(loadSourceDescriptor(ADAPTER_DIR)),
  };
}

function ref(snapshot: SourceSnapshot, recordKey: string) {
  return { sourceId: "swissmedic", snapshotId: snapshot.id, recordKey };
}

function emptyDate(value?: string): string | undefined {
  if (!value || value.startsWith("9999")) return undefined;
  return value;
}

function udcDisplay(
  udc: Map<string, string>,
  table: string,
  code: string,
): string | undefined {
  return (
    udc.get(`${table}|${code}|E`) ??
    udc.get(`${table}|${code}|D`) ??
    udc.get(`${table}|${code}|F`) ??
    udc.get(`${table}|${code}|I`)
  );
}

function indexUdc(rows: Record<string, unknown>[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const table = text(row.USER_DEFINED_CODE);
    const code = text(row.CODE_VALUE);
    const lang = text(row.SPRACH_CODE);
    const display =
      optionalText(row.BESCHREIBUNG_LANG) ??
      optionalText(row.BESCHREIBUNG_2) ??
      optionalText(row.BESCHREIBUNG_1);
    if (table && code && display) map.set(`${table}|${code}|${lang}`, display);
  }
  return map;
}

function coded(
  system: string,
  code: string,
  udc: Map<string, string>,
  table: string,
): CodedValue {
  return { system, code, display: udcDisplay(udc, table, code) };
}

function packDescription(pack: string, size?: string, unit?: string, free?: string): string {
  return [pack, size, unit, free].filter((p) => p && p.length > 0).join(" ").trim();
}

function hasXmllint(): boolean {
  try {
    execFileSync("xmllint", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function buildDeclaration(
  snapshot: SourceSnapshot,
  authNo: string,
  seq: string,
  rows: Record<string, unknown>[],
  synonyms: Map<string, string>,
  udc: Map<string, string>,
): { declarationRows: DeclarationRow[]; ingredients: Ingredient[]; newSubstances: Substance[] } {
  const sorted = [...rows].sort((a, b) => {
    const sa = Number(text(a.SORTIERUNG_ZEILENNUMMER) || text(a.ZEILENNUMMER) || 0);
    const sb = Number(text(b.SORTIERUNG_ZEILENNUMMER) || text(b.ZEILENNUMMER) || 0);
    return sa - sb;
  });

  const basisRows = sorted.filter((r) => text(r.ZEILENTYP) === "G");
  const basisText = basisRows
    .map((r) => synonyms.get(text(r.STOFF_ID)) ?? text(r.KOMPONENTE))
    .filter(Boolean)
    .join("; ");
  const basisSafe = parseBasis(basisText);

  const declarationRows: DeclarationRow[] = [];
  const ingredients: Ingredient[] = [];
  const newSubstances: Substance[] = [];

  for (const row of sorted) {
    const rowNo = text(row.ZEILENNUMMER);
    const component = text(row.KOMPONENTENNUMMER);
    const stoffId = optionalText(row.STOFF_ID);
    const name = (stoffId ? synonyms.get(stoffId) : undefined) ?? optionalText(row.KOMPONENTE) ?? "";
    const rowKey = authorityKey([authNo, seq, component, rowNo, stoffId ?? ""]);
    const rowId = canonicalId({
      jurisdiction: JURISDICTION,
      identityAuthority: AUTHORITY,
      entityType: "DeclarationRow",
      authorityKey: rowKey,
    });
    const qty = optionalText(row.MENGE);
    const qtyUnit = optionalText(row.MENGEN_EINHEIT);
    const roleCode = optionalText(row.STOFFKATEGORIE);
    const sourceText = [name, qty, qtyUnit, basisText].filter(Boolean).join(" ");
    let substanceId: DeclarationRow["substanceId"];
    if (stoffId) {
      const sid = canonicalId({
        jurisdiction: JURISDICTION,
        identityAuthority: AUTHORITY,
        entityType: "Substance",
        authorityKey: authorityKey([stoffId]),
      });
      substanceId = sid;
      newSubstances.push({
        id: sid,
        identityAuthority: AUTHORITY,
        authorityKey: stoffId,
        name,
        identifiers: [{ system: SWISSMEDIC_SYSTEMS.substance, value: stoffId }],
      });
    }
    declarationRows.push({
      id: rowId,
      componentNumber: component,
      componentName: optionalText(row.KOMPONENTE),
      rowNumber: rowNo,
      sortOrder: optionalText(row.SORTIERUNG_ZEILENNUMMER),
      rowType: text(row.ZEILENTYP) || "S",
      substanceId,
      sourceSubstanceId: stoffId,
      substanceName: name,
      roleCode: roleCode
        ? coded(SWISSMEDIC_SYSTEMS.ingredientRole, roleCode, udc, "SUBSTANCE_CATEGORY")
        : undefined,
      quantity: qty,
      quantityUnit: qtyUnit ? coded(SWISSMEDIC_SYSTEMS.packageUnit, qtyUnit, udc, "UNIT") : undefined,
      declarationFormat: optionalText(row.DEKLARATIONSART),
      sourceText,
    });

    const isSubstanceRow = (text(row.ZEILENTYP) || "S") === "S" && Boolean(name);
    if (isSubstanceRow) {
      const structured = Boolean(qty && basisSafe);
      ingredients.push({
        id: canonicalId({
          jurisdiction: JURISDICTION,
          identityAuthority: AUTHORITY,
          entityType: "Ingredient",
          authorityKey: rowKey,
        }),
        declarationRowId: rowId,
        name,
        role: roleCode
          ? coded(SWISSMEDIC_SYSTEMS.ingredientRole, roleCode, udc, "SUBSTANCE_CATEGORY")
          : { system: SWISSMEDIC_SYSTEMS.ingredientRole, code: "unknown" },
        strength: {
          numeratorValue: qty,
          numeratorUnit: qtyUnit ? { system: SWISSMEDIC_SYSTEMS.packageUnit, code: qtyUnit } : undefined,
          denominatorValue: structured ? basisSafe?.value : undefined,
          denominatorUnit: structured ? basisSafe?.unit : undefined,
          text: sourceText,
          structured,
        },
      });
    }
  }
  return { declarationRows, ingredients, newSubstances };
}

function parseBasis(textValue: string): { value: string; unit: CodedValue } | undefined {
  if (!textValue) return undefined;
  const m = textValue.match(/per\s+(\d+(?:[.,]\d+)?)\s*([a-zA-Zµμ]+)/i);
  if (!m?.[1] || !m[2]) return undefined;
  return {
    value: m[1],
    unit: { system: SWISSMEDIC_SYSTEMS.packageUnit, code: m[2] },
  };
}
