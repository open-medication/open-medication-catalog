import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { authorityKey } from "../../branded.js";
import type { Catalogue, MappingCoverageReport, Package, SourceSnapshot } from "../../canonical/types.js";
import { repoPath } from "../../paths.js";
import { extractZip, fetchBinary, fileSignatureOk, sha256 } from "../../security.js";
import { asArray, optionalText, parseXmlFile, parseXmlString, text } from "../../xml.js";
import type { Adapter, AdapterContext, AdapterMetadata, FetchResult, PartialCatalogue } from "../types.js";

const ADAPTER_DIR = repoPath("adapters/ch/refdata");

export class RefdataAdapter implements Adapter {
  metadata(): AdapterMetadata {
    const desc = YAML.parse(fs.readFileSync(path.join(ADAPTER_DIR, "source.yaml"), "utf8")) as {
      terms: { url: string };
    };
    return {
      sourceId: "refdata",
      identityAuthority: "swissmedic",
      jurisdiction: "CH",
      credentialsRequired: true,
      commercialUse: "allowed",
      redistribution: "allowed",
      attributionRequired: true,
      updateFrequency: "daily",
      termsUrl: desc.terms.url,
    };
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
        termsReviewedAt: "2026-08-28",
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
  tradeStatus?: string;
  name?: string;
}

export function collectArticles(doc: unknown): RefdataArticle[] {
  const rows: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const rec = node as Record<string, unknown>;
    const keys = Object.keys(rec);
    const looksLikeArticle =
      first(rec, ["GTIN", "Gtin", "EAN", "BC"]) &&
      first(rec, ["AUTHNR", "AuthNr", "SwissmedicNo", "ZULASSUNGSNUMMER", "IkSnr", "IKSNR"]);
    if (looksLikeArticle) rows.push(rec);
    if ("ARTICLE" in rec) asArray(rec.ARTICLE).forEach((a) => walk(a));
    else Object.values(rec).forEach(walk);
    void keys;
  };
  walk(doc);
  return rows.map((row) => ({
    gtin: first(row, ["GTIN", "Gtin", "EAN", "BC"]),
    authNr: first(row, ["AUTHNR", "AuthNr", "SwissmedicNo", "ZULASSUNGSNUMMER", "IkSnr", "IKSNR"]),
    packCode: first(row, ["PACKCODE", "PackCode", "PACKUNGSCODE", "Pkg", "PACK"]),
    tradeStatus: first(row, ["STATUS", "TradeStatus", "Handelsstatus", "INCOMMERCE"]),
    name: first(row, ["NAME", "DSCR", "DESCRIPTION", "Bezeichnung"]),
  }));
}

export function applyRefdata(catalogue: Catalogue, articles: RefdataArticle[], snapshot: SourceSnapshot): void {
  const byAuthPack = new Map<string, RefdataArticle>();
  for (const a of articles) {
    if (!a.authNr || !a.packCode) continue;
    byAuthPack.set(`${a.authNr}|${a.packCode}`, a);
  }
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
