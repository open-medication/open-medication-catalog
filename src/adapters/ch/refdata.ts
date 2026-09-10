import fs from "node:fs";
import path from "node:path";
import type { Catalogue, MappingCoverageReport, SourceSnapshot } from "../../canonical/types.js";
import { repoPath } from "../../paths.js";
import { extractZip, fetchBinary, fileSignatureOk, sha256 } from "../../security.js";
import { asArray, optionalText, parseXmlFile, parseXmlString } from "../../xml.js";
import { loadSourceDescriptor, metadataFromDescriptor, snapshotTerms } from "../descriptor.js";
import type { Adapter, AdapterContext, AdapterMetadata, FetchResult, PartialCatalogue } from "../types.js";

const ADAPTER_DIR = repoPath("adapters/ch/refdata");

export class RefdataAdapter implements Adapter {
  metadata(): AdapterMetadata {
    return metadataFromDescriptor(loadSourceDescriptor(ADAPTER_DIR));
  }

  async fetch(ctx: AdapterContext): Promise<FetchResult> {
    const work = path.join(ctx.cacheDir, "refdata");
    fs.mkdirSync(work, { recursive: true });
    let buf: Buffer;
    let uri: string;
    if (ctx.inputPath) {
      buf = fs.readFileSync(ctx.inputPath);
      uri = `file:${ctx.inputPath}`;
    } else {
      const key = ctx.secrets.REFDATA_API_KEY;
      if (!key) {
        throw new Error("REFDATA_API_KEY is required to fetch Refdata (or pass --input)");
      }
      uri = "https://api.refdata.ch/articles/2.0/Refdata.Articles.zip";
      buf = await fetchBinary(uri, { headers: { "X-API-Key": key } });
    }
    if (!fileSignatureOk(buf, "zip") && !fileSignatureOk(buf, "xml")) {
      throw new Error("Refdata input is neither ZIP nor XML");
    }
    const dest = path.join(work, "extracted");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    if (fileSignatureOk(buf, "zip")) {
      await extractZip(buf, dest);
    } else {
      fs.writeFileSync(path.join(dest, "articles.xml"), buf);
    }
    return {
      files: fs.readdirSync(dest).map((f) => path.join(dest, f)),
      snapshot: {
        id: sha256(buf).slice(0, 16),
        sourceId: "refdata",
        identityAuthority: "swissmedic",
        retrievedAt: new Date(0).toISOString(),
        sha256: sha256(buf),
        uri,
        ...snapshotTerms(loadSourceDescriptor(ADAPTER_DIR)),
      },
    };
  }

  async validateSource(_ctx: AdapterContext, fetched: FetchResult): Promise<void> {
    if (fetched.files.length === 0) throw new Error("Refdata fetch produced no files");
  }

  async parse(_ctx: AdapterContext, fetched: FetchResult): Promise<RefdataArticle[]> {
    const xmlFile = fetched.files.find((f) => f.toLowerCase().endsWith(".xml"));
    if (!xmlFile) throw new Error("No Refdata XML file");
    const doc = parseXmlFile(xmlFile);
    return collectArticles(doc);
  }

  async normalize(
    _ctx: AdapterContext,
    parsed: unknown,
    snapshot: SourceSnapshot,
  ): Promise<PartialCatalogue> {
    const articles = parsed as RefdataArticle[];
    // Refdata does not create products. Enrichment is applied in compose().
    snapshot.sourceEffectiveDate = snapshot.sourceEffectiveDate ?? snapshot.retrievedAt.slice(0, 10);
    return {
      productGroups: [],
      medicinalProducts: [],
      packages: [],
      organizations: [],
      authorizations: [],
      substances: [],
      reimbursements: [],
      sourceSnapshots: [snapshot],
      mappingCoverage: [
        {
          sourceId: "refdata",
          fields: [
            { name: "gtin", classification: "mapped", count: articles.filter((a) => a.gtin).length },
            { name: "authNr", classification: "mapped", count: articles.filter((a) => a.authNr).length },
            { name: "packCode", classification: "mapped", count: articles.filter((a) => a.packCode).length },
            { name: "tradeStatus", classification: "mapped", count: articles.filter((a) => a.tradeStatus).length },
            { name: "names", classification: "mapped", count: articles.filter((a) => a.names.length).length },
            {
              name: "marketingValidFrom",
              classification: "mapped",
              count: articles.filter((a) => a.marketingValidFrom).length,
            },
            { name: "atc", classification: "intentionally-ignored", count: articles.filter((a) => a.atc).length },
            {
              name: "abgabekategorie",
              classification: "intentionally-ignored",
              count: articles.filter((a) => a.abgabekategorie).length,
            },
          ],
          unknownFields: [],
        },
      ],
    };
  }

  qualityReport(catalogue: Catalogue): MappingCoverageReport {
    return catalogue.mappingCoverage.find((m) => m.sourceId === "refdata") ?? {
      sourceId: "refdata",
      fields: [],
      unknownFields: [],
    };
  }
}

export interface RefdataArticle {
  gtin?: string;
  authNr?: string;
  packCode?: string;
  sequence?: string;
  tradeStatus?: string;
  type?: string;
  atc?: string;
  abgabekategorie?: string;
  names: { language: string; text: string }[];
  marketingValidFrom?: string;
  marketingValidTo?: string;
  extraKeys: string[];
}

const KNOWN_ARTICLE_KEYS = new Set(
  [
    "GTIN",
    "GTIN13",
    "EAN",
    "BC",
    "AUTHNR",
    "AUTH_NR",
    "SWISSMEDICNO",
    "ZULASSUNGSNUMMER",
    "IKSNR",
    "IKS_NR",
    "PACKCODE",
    "PACK_CODE",
    "PACKUNGSCODE",
    "PKG",
    "PACK",
    "STATUS",
    "TRADESTATUS",
    "HANDELSSTATUS",
    "INCOMMERCE",
    "TYPE",
    "ATC",
    "ATCCODE",
    "ATC_CODE",
    "ABGABEKATEGORIE",
    "ABGABE_KATEGORIE",
    "SMCAT",
    "DOSISSTAERKE",
    "SEQUENZNUMMER",
    "SEQ",
    "NAME",
    "NAME_DE",
    "NAME_FR",
    "NAME_IT",
    "NAME_EN",
    "NOM_DE",
    "NOM_FR",
    "NOM_IT",
    "NOM_EN",
    "DSCR",
    "DSCRD",
    "DSCRF",
    "DSCRI",
    "DSCRE",
    "DESCRIPTION",
    "BEZEICHNUNG",
    "VALIDFROM",
    "VALID_FROM",
    "VALIDTO",
    "VALID_TO",
    "INCOMMERCEFROM",
    "INCOMMERCETO",
    "DATEFROM",
    "DATETO",
    "HANDELSSTATUSVON",
    "HANDELSSTATUSBIS",
    "FROM",
    "TO",
  ].map((k) => k.toLowerCase()),
);

export function collectArticles(doc: unknown): RefdataArticle[] {
  const rows: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const rec = node as Record<string, unknown>;
    const looksLikeArticle =
      first(rec, ["GTIN", "Gtin", "EAN", "BC"]) &&
      first(rec, ["AUTHNR", "AuthNr", "SwissmedicNo", "ZULASSUNGSNUMMER", "IkSnr", "IKSNR"]);
    if (looksLikeArticle) rows.push(rec);
    if ("ARTICLE" in rec) asArray(rec.ARTICLE).forEach((a) => walk(a));
    else Object.values(rec).forEach(walk);
  };
  walk(doc);
  return rows.map(rowToArticle);
}

function rowToArticle(row: Record<string, unknown>): RefdataArticle {
  const names: { language: string; text: string }[] = [];
  const pushName = (language: string, text: string | undefined) => {
    if (text) names.push({ language, text });
  };
  pushName("de", first(row, ["NAME_DE", "NOM_DE", "DSCRD"]));
  pushName("fr", first(row, ["NAME_FR", "NOM_FR", "DSCRF"]));
  pushName("it", first(row, ["NAME_IT", "NOM_IT", "DSCRI"]));
  pushName("en", first(row, ["NAME_EN", "NOM_EN", "DSCRE"]));
  if (names.length === 0) {
    const generic = first(row, ["NAME", "DSCR", "DESCRIPTION", "Bezeichnung"]);
    if (generic) names.push({ language: "de", text: generic });
  }
  const extraKeys = Object.keys(row).filter((k) => {
    if (k.startsWith(":") || k === "?xml") return false;
    return !KNOWN_ARTICLE_KEYS.has(k.toLowerCase());
  });
  return {
    gtin: first(row, ["GTIN", "Gtin", "EAN", "BC"]),
    authNr: first(row, ["AUTHNR", "AuthNr", "SwissmedicNo", "ZULASSUNGSNUMMER", "IkSnr", "IKSNR"]),
    packCode: first(row, ["PACKCODE", "PackCode", "PACKUNGSCODE", "Pkg", "PACK"]),
    sequence: first(row, ["DOSISSTAERKE", "SEQUENZNUMMER", "Seq"]),
    tradeStatus: first(row, ["STATUS", "TradeStatus", "Handelsstatus", "INCOMMERCE"]),
    type: first(row, ["TYPE"]),
    atc: first(row, ["ATC", "ATC_CODE", "ATCCODE"]),
    abgabekategorie: first(row, ["ABGABEKATEGORIE", "ABGABE_KATEGORIE", "SMCAT"]),
    names,
    marketingValidFrom: first(row, [
      "VALIDFROM",
      "VALID_FROM",
      "INCOMMERCEFROM",
      "DATEFROM",
      "HANDELSSTATUSVON",
    ]),
    marketingValidTo: first(row, ["VALIDTO", "VALID_TO", "INCOMMERCETO", "DATETO", "HANDELSSTATUSBIS"]),
    extraKeys,
  };
}

export function applyRefdata(catalogue: Catalogue, articles: RefdataArticle[], snapshot: SourceSnapshot): void {
  const byAuthPack = new Map<string, RefdataArticle>();
  for (const a of articles) {
    if (!a.authNr || !a.packCode) continue;
    if (a.type && a.type.toUpperCase() === "NONPHARMA") continue;
    byAuthPack.set(`${a.authNr}|${a.packCode}`, a);
  }
  let atcMismatch = 0;
  let abgabeMismatch = 0;
  for (const pkg of catalogue.packages) {
    const [auth, , pack] = pkg.authorityKey.split("|");
    if (!auth || !pack) continue;
    const hit = byAuthPack.get(`${auth}|${pack}`);
    if (!hit) continue;
    if (hit.gtin) {
      pkg.gtin = hit.gtin;
      pkg.identifiers = [
        ...pkg.identifiers.filter((i) => i.system !== "https://www.gs1.org/gtin"),
        { system: "https://www.gs1.org/gtin", value: hit.gtin },
      ];
      pkg.fieldProvenance.gtin = { sourceId: "refdata", snapshotId: snapshot.id, originalField: "GTIN" };
    }
    if (hit.tradeStatus) {
      pkg.marketingStatus = {
        system: "https://fhir.openmedicationcatalog.org/CodeSystem/ch-refdata-trade-status",
        code: hit.tradeStatus,
      };
      pkg.fieldProvenance.marketingStatus = {
        sourceId: "refdata",
        snapshotId: snapshot.id,
        originalField: "STATUS",
      };
    }
    if (hit.names.length) {
      pkg.names = hit.names.map((n) => ({ text: n.text, language: n.language }));
      pkg.fieldProvenance.names = { sourceId: "refdata", snapshotId: snapshot.id, originalField: "NAME_DE" };
    }
    if (hit.marketingValidFrom) {
      pkg.marketingValidFrom = hit.marketingValidFrom;
      pkg.fieldProvenance.marketingValidFrom = {
        sourceId: "refdata",
        snapshotId: snapshot.id,
        originalField: "VALIDFROM",
      };
    }
    if (hit.marketingValidTo) {
      pkg.marketingValidTo = hit.marketingValidTo;
      pkg.fieldProvenance.marketingValidTo = {
        sourceId: "refdata",
        snapshotId: snapshot.id,
        originalField: "VALIDTO",
      };
    }
    const group = catalogue.productGroups.find((g) => g.id === pkg.productGroupId);
    if (hit.atc && group?.atc?.code && hit.atc !== group.atc.code) atcMismatch += 1;
    const swissAbgabe = pkg.metadata?.abgabekategorie;
    if (hit.abgabekategorie && swissAbgabe && hit.abgabekategorie !== swissAbgabe) abgabeMismatch += 1;
  }
  const coverage = catalogue.mappingCoverage.find((m) => m.sourceId === "refdata");
  if (coverage) {
    if (atcMismatch) {
      coverage.fields.push({ name: "atc-mismatch", classification: "intentionally-ignored", count: atcMismatch });
    }
    if (abgabeMismatch) {
      coverage.fields.push({
        name: "abgabekategorie-mismatch",
        classification: "intentionally-ignored",
        count: abgabeMismatch,
      });
    }
    const extras = [...new Set(articles.flatMap((a) => a.extraKeys))].sort();
    coverage.unknownFields = extras;
  }
}

function first(row: Record<string, unknown>, names: string[]): string | undefined {
  for (const n of names) {
    if (n in row) {
      const v = optionalText(row[n]);
      if (v) return v;
    }
    const found = Object.keys(row).find((k) => k.toLowerCase() === n.toLowerCase());
    if (found) {
      const v = optionalText(row[found]);
      if (v) return v;
    }
  }
  return undefined;
}

void parseXmlString;
