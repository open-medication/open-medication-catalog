import fs from "node:fs";
import path from "node:path";
import type { Catalogue, MappingCoverageReport, SourceSnapshot } from "../../canonical/types.js";
import { OMC_SYSTEMS } from "../../canonical/types.js";
import { repoPath } from "../../paths.js";
import { extractZip, fetchBinary, fileSignatureOk, sha256 } from "../../security.js";
import { asArray, optionalText, parseXmlFile } from "../../xml.js";
import { loadSourceDescriptor, metadataFromDescriptor, snapshotTerms } from "../descriptor.js";
import type { Adapter, AdapterContext, AdapterMetadata, FetchResult, PartialCatalogue } from "../types.js";

const ADAPTER_DIR = repoPath("adapters/ch/refdata");

/**
 * Refdata publishes the Artikel-refdatabase as nested SIMIS/GS1 XML
 * (`https://simisinfo.refdata.ch/Articles/N`):
 *
 *   <Articles generatedOn="…">
 *     <Article>
 *       <MedicinalProduct>
 *         <Domain>Human|Veterinary</Domain>
 *         <LegalStatusOfSupply>B</LegalStatusOfSupply>
 *         <RegulatedAuthorisationIdentifier>0058501</RegulatedAuthorisationIdentifier>  <!-- auth(5)+seq(2) -->
 *         <ProductClassification><ProductClass>PHARMA|NONPHARMA</ProductClass><Atc>…</Atc></ProductClassification>
 *       </MedicinalProduct>
 *       <PackagedProduct>
 *         <RegulatedAuthorisationIdentifier>00585001</RegulatedAuthorisationIdentifier>   <!-- auth(5)+pack(3) -->
 *         <DataCarrierIdentifier>7680005850010</DataCarrierIdentifier>                     <!-- GTIN -->
 *         <Name><Language>DE</Language><FullName>…</FullName></Name>…
 *       </PackagedProduct>
 *     </Article>
 *
 * Swissmedic pads its numbers inside Refdata (auth 5, seq 2, pack 3 digits) but
 * does not pad them in its own OGD files, so join keys are compared unpadded.
 */
export interface RefdataArticle {
  gtin?: string;
  /** Swissmedic authorisation number, unpadded ("585" for Refdata "00585"). */
  authNr?: string;
  /** Swissmedic pack code, unpadded ("1" for Refdata "001"). */
  packCode?: string;
  /** Swissmedic sequence number, unpadded ("01" for Refdata "0001"/"01"). */
  sequence?: string;
  productClass?: string;
  domain?: string;
  atc?: string;
  legalStatusOfSupply?: string;
  names: { language: string; text: string }[];
  /** Element names we do not map; surfaced as unknown fields so format drift is visible. */
  extraKeys: string[];
}

export interface RefdataParsed {
  articles: RefdataArticle[];
  /** Root `generatedOn` attribute (ISO timestamp) — the source's effective date. */
  generatedOn?: string;
}

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

  async parse(_ctx: AdapterContext, fetched: FetchResult): Promise<RefdataParsed> {
    const xmlFile = fetched.files.find((f) => f.toLowerCase().endsWith(".xml"));
    if (!xmlFile) throw new Error("No Refdata XML file");
    const doc = parseXmlFile(xmlFile);
    return { articles: collectArticles(doc), generatedOn: collectGeneratedOn(doc) };
  }

  async normalize(
    _ctx: AdapterContext,
    parsed: unknown,
    snapshot: SourceSnapshot,
  ): Promise<PartialCatalogue> {
    const data = parsed as RefdataParsed;
    const articles = data.articles;
    // Real files carry a generatedOn timestamp; prefer it over a placeholder date.
    if (data.generatedOn) snapshot.sourceEffectiveDate = data.generatedOn.slice(0, 10);
    // Refdata does not create products. Enrichment is applied in compose().
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
            { name: "domain", classification: "mapped", count: articles.filter((a) => a.domain).length },
            { name: "productClass", classification: "mapped", count: articles.filter((a) => a.productClass).length },
            { name: "names", classification: "mapped", count: articles.filter((a) => a.names.length).length },
            {
              name: "legalStatusOfSupply",
              classification: "intentionally-ignored",
              count: articles.filter((a) => a.legalStatusOfSupply).length,
            },
            { name: "atc", classification: "intentionally-ignored", count: articles.filter((a) => a.atc).length },
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

const KNOWN_ELEMENTS = new Set(
  [
    "medicinalproduct",
    "packagedproduct",
    "identifier",
    "domain",
    "legalstatusofsupply",
    "regulatedauthorisationidentifier",
    "productclassification",
    "productclass",
    "atc",
    "datacarrieridentifier",
    "holder",
    "name",
    "language",
    "fullname",
  ].map((k) => k.toLowerCase()),
);

/** Find a child key case-insensitively, ignoring namespace prefixes (`ns0:Article`). */
function findKey(node: Record<string, unknown>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const key of Object.keys(node)) {
    const bare = key.includes(":") ? (key.split(":").pop() ?? key) : key;
    if (bare.toLowerCase() === target) return key;
  }
  return undefined;
}

function child(node: Record<string, unknown> | undefined, name: string): Record<string, unknown> | undefined {
  if (!node) return undefined;
  const key = findKey(node, name);
  if (key === undefined) return undefined;
  const value = node[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function text(node: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!node) return undefined;
  const key = findKey(node, name);
  if (key === undefined) return undefined;
  const value = node[key];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? optionalText(first) : undefined;
}

/** Refdata zero-pads Swissmedic numbers (auth to 5, pack to 3, seq to 2); compare unpadded. */
export function unpad(value: string): string {
  const stripped = value.replace(/^0+/, "");
  return stripped.length > 0 ? stripped : "0";
}

/**
 * Split a RegulatedAuthorisationIdentifier into its unpadded parts:
 * 8 digits = authorisation(5) + pack(3), 7 digits = authorisation(5) + sequence(2).
 */
function splitRegulatedAuthorisationId(
  value: string | undefined,
  length: 7 | 8,
): [string, string] | undefined {
  if (!value || value.length !== length || !/^\d+$/.test(value)) return undefined;
  return [unpad(value.slice(0, 5)), unpad(value.slice(5))];
}

function gtinOf(value: string | undefined): string | undefined {
  return value && /^\d{13,14}$/.test(value) ? value : undefined;
}

export function collectGeneratedOn(doc: unknown): string | undefined {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return undefined;
  const rec = doc as Record<string, unknown>;
  const key = findKey(rec, "Articles");
  if (key === undefined) return undefined;
  const value = rec[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const attrs = value as Record<string, unknown>;
  const generated = Object.keys(attrs).find((k) => k.toLowerCase() === "@_generatedon");
  const raw = generated === undefined ? undefined : attrs[generated];
  return typeof raw === "string" ? optionalText(raw) : undefined;
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
    const key = findKey(rec, "Article");
    if (key !== undefined) {
      for (const article of asArray(rec[key])) {
        if (article && typeof article === "object" && !Array.isArray(article)) {
          rows.push(article as Record<string, unknown>);
        }
      }
    }
    for (const value of Object.values(rec)) walk(value);
  };
  walk(doc);
  return rows.map(rowToArticle);
}

function rowToArticle(row: Record<string, unknown>): RefdataArticle {
  const medicinal = child(row, "MedicinalProduct");
  const packaged = child(row, "PackagedProduct");
  const classification = child(medicinal, "ProductClassification");

  const names: { language: string; text: string }[] = [];
  if (packaged) {
    const nameKey = findKey(packaged, "Name");
    if (nameKey !== undefined) {
      for (const entry of asArray(packaged[nameKey])) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const name = entry as Record<string, unknown>;
        const language = text(name, "Language")?.toLowerCase();
        const fullName = text(name, "FullName");
        if (language && fullName) names.push({ language, text: fullName });
      }
    }
  }

  const packagedId = splitRegulatedAuthorisationId(
    text(packaged, "RegulatedAuthorisationIdentifier"),
    8,
  );
  const medicinalId = splitRegulatedAuthorisationId(
    text(medicinal, "RegulatedAuthorisationIdentifier"),
    7,
  );

  return {
    gtin: gtinOf(text(packaged, "DataCarrierIdentifier")),
    authNr: packagedId?.[0],
    packCode: packagedId?.[1],
    sequence: medicinalId?.[1],
    productClass: text(classification, "ProductClass"),
    domain: text(medicinal, "Domain"),
    atc: text(classification, "Atc"),
    legalStatusOfSupply: text(medicinal, "LegalStatusOfSupply"),
    names,
    extraKeys: extraElementKeys(row, medicinal, packaged, classification),
  };
}

function extraElementKeys(
  row: Record<string, unknown>,
  medicinal: Record<string, unknown> | undefined,
  packaged: Record<string, unknown> | undefined,
  classification: Record<string, unknown> | undefined,
): string[] {
  const out: string[] = [];
  const visit = (node: Record<string, unknown> | undefined): void => {
    if (!node) return;
    for (const key of Object.keys(node)) {
      if (key.startsWith("@_") || key === "#text") continue;
      const bare = (key.includes(":") ? (key.split(":").pop() ?? key) : key).toLowerCase();
      if (!KNOWN_ELEMENTS.has(bare) && !out.includes(bare)) out.push(bare);
    }
  };
  visit(row);
  visit(medicinal);
  visit(packaged);
  visit(classification);
  return out;
}

export function applyRefdata(catalogue: Catalogue, articles: RefdataArticle[], snapshot: SourceSnapshot): void {
  const byAuthPack = new Map<string, RefdataArticle>();
  for (const a of articles) {
    if (!a.authNr || !a.packCode) continue;
    if (a.productClass && a.productClass.toUpperCase() === "NONPHARMA") continue;
    byAuthPack.set(`${a.authNr}|${a.packCode}`, a);
  }
  let atcMismatch = 0;
  let legalStatusMismatch = 0;
  let domainSkipped = 0;
  for (const pkg of catalogue.packages) {
    const [auth, , pack] = pkg.authorityKey.split("|");
    if (!auth || !pack) continue;
    const hit = byAuthPack.get(`${unpad(auth)}|${unpad(pack)}`);
    if (!hit) continue;
    // Refdata carries HAM and TAM in one file; do not cross-pollute domains.
    if (hit.domain && pkg.domain.code && hit.domain !== pkg.domain.code) {
      domainSkipped += 1;
      continue;
    }
    if (hit.gtin) {
      pkg.gtin = hit.gtin;
      pkg.identifiers = [
        ...pkg.identifiers.filter((i) => i.system !== OMC_SYSTEMS.gtin),
        { system: OMC_SYSTEMS.gtin, value: hit.gtin },
      ];
      pkg.fieldProvenance.gtin = {
        sourceId: "refdata",
        snapshotId: snapshot.id,
        originalField: "PackagedProduct/DataCarrierIdentifier",
      };
    }
    if (hit.names.length) {
      pkg.names = hit.names;
      pkg.fieldProvenance.names = { sourceId: "refdata", snapshotId: snapshot.id, originalField: "PackagedProduct/Name" };
    }
    const group = catalogue.productGroups.find((g) => g.id === pkg.productGroupId);
    if (hit.atc && group?.atc?.code && hit.atc !== group.atc.code) atcMismatch += 1;
    const swissAbgabe = pkg.metadata?.abgabekategorie;
    if (hit.legalStatusOfSupply && swissAbgabe && hit.legalStatusOfSupply !== swissAbgabe) {
      legalStatusMismatch += 1;
    }
  }
  const coverage = catalogue.mappingCoverage.find((m) => m.sourceId === "refdata");
  if (coverage) {
    if (atcMismatch) {
      coverage.fields.push({ name: "atc-mismatch", classification: "intentionally-ignored", count: atcMismatch });
    }
    if (legalStatusMismatch) {
      coverage.fields.push({
        name: "legal-status-mismatch",
        classification: "intentionally-ignored",
        count: legalStatusMismatch,
      });
    }
    if (domainSkipped) {
      coverage.fields.push({
        name: "domain-skipped",
        classification: "intentionally-ignored",
        count: domainSkipped,
      });
    }
    coverage.unknownFields = [...new Set(articles.flatMap((a) => a.extraKeys))].sort();
  }
}
