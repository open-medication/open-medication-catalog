import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  type Catalogue,
  type MappingCoverageReport,
  type SourceSnapshot,
  WHO_ATC_SYSTEM,
} from "../../canonical/types.js";
import { repoPath } from "../../paths.js";
import { extractZip, fetchBinary, fileSignatureOk, sha256 } from "../../security.js";
import { loadSourceDescriptor, metadataFromDescriptor, snapshotTerms } from "../descriptor.js";
import type { Adapter, AdapterContext, AdapterMetadata, FetchResult, PartialCatalogue } from "../types.js";

const ADAPTER_DIR = repoPath("adapters/fr/openmedic");
const JURISDICTION = "FR";
const SOURCE_ID = "openmedic";
const DOWNLOAD_HOST = "https://open-data-assurance-maladie.ameli.fr";

/**
 * Open Medic (Assurance Maladie / ameli open data) is the only current bulk
 * source of ATC codes for French medicines: ANSM removed CIS_ATC_bdpm.txt
 * from the public BDM when it moved to the v4 file set (the URL answers
 * 200 with an empty body and the file is absent from the official format
 * PDF). Open Medic keys ATC per CIP13 presentation; we join CIP13 → package
 * and require all matched presentations of a product to agree before
 * attaching the ATC to the product.
 */
export class OpenMedicAdapter implements Adapter {
  metadata(): AdapterMetadata {
    return metadataFromDescriptor(loadSourceDescriptor(ADAPTER_DIR));
  }

  async fetch(ctx: AdapterContext): Promise<FetchResult> {
    const work = path.join(ctx.cacheDir, SOURCE_ID);
    fs.mkdirSync(work, { recursive: true });

    if (ctx.inputPath) {
      const buf = fs.readFileSync(ctx.inputPath);
      if (fileSignatureOk(buf, "zip")) {
        const dest = path.join(work, "extracted");
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });
        await extractZip(buf, dest);
        return {
          files: listCsv(dest),
          rawArchivePath: ctx.inputPath,
          snapshot: snapshotFrom(buf, ctx, `file:${ctx.inputPath}`),
        };
      }
      if (buf.toString("latin1", 0, Math.min(buf.length, 200)).trim().startsWith("ATC1")) {
        const dest = path.join(work, "extracted");
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "OPEN_MEDIC.csv"), buf);
        return {
          files: [path.join(dest, "OPEN_MEDIC.csv")],
          snapshot: snapshotFrom(buf, ctx, `file:${ctx.inputPath}`),
        };
      }
      throw new Error("Open Medic input must be an OPEN_MEDIC zip or CSV");
    }

    // Live: editions are annual and lag the calendar year (the 2025 edition
    // shipped mid-2026). Try last year first, then the year before.
    const releaseYear = Number(ctx.releaseMonth.slice(0, 4));
    const candidates = [releaseYear - 1, releaseYear - 2].filter((y) => y >= 2014);
    const probed: string[] = [];
    for (const edition of candidates) {
      const pageUrl = openMedicDownloadPage(edition);
      probed.push(pageUrl);
      let page: Buffer;
      try {
        page = await fetchBinary(pageUrl);
      } catch {
        continue;
      }
      const fileUrl = extractOpenMedicZipUrl(page, pageUrl);
      if (!fileUrl) continue;
      const buf = await fetchBinary(fileUrl);
      if (!fileSignatureOk(buf, "zip")) throw new Error(`Open Medic download is not a ZIP (${fileUrl})`);
      const archiveCopy = path.join(work, `OPEN_MEDIC_${edition}.zip`);
      fs.writeFileSync(archiveCopy, buf);
      const dest = path.join(work, "extracted");
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(dest, { recursive: true });
      await extractZip(buf, dest);
      return {
        files: listCsv(dest),
        rawArchivePath: archiveCopy,
        snapshot: snapshotFrom(buf, ctx, pageUrl, `${edition}-12-31`),
      };
    }
    throw new Error(`No Open Medic edition found (probed: ${probed.join(", ")})`);
  }

  async validateSource(_ctx: AdapterContext, fetched: FetchResult): Promise<void> {
    if (fetched.files.length === 0) throw new Error("Open Medic fetch produced no files");
  }

  async parse(_ctx: AdapterContext, fetched: FetchResult): Promise<OpenMedicParsed> {
    const csvFile = fetched.files.find((f) => f.toLowerCase().endsWith(".csv"));
    if (!csvFile) throw new Error("No Open Medic CSV file");
    const edition = Number(path.basename(csvFile).match(/OPEN_MEDIC_(\d{4})/i)?.[1] ?? 0) || undefined;
    const { atcByCip, rows, unknownColumns } = await parseOpenMedicCsv(csvFile);
    return { edition, atcByCip, rows, cipCount: atcByCip.size, unknownColumns };
  }

  async normalize(
    _ctx: AdapterContext,
    parsed: unknown,
    snapshot: SourceSnapshot,
  ): Promise<PartialCatalogue> {
    const data = parsed as OpenMedicParsed;
    // Open Medic does not create products; enrichment is applied in compose().
    // The edition covers deliveries through the end of its calendar year.
    if (data.edition) snapshot.sourceEffectiveDate = `${data.edition}-12-31`;
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
          sourceId: SOURCE_ID,
          fields: [
            { name: "cip13", classification: "mapped", count: data.cipCount },
            { name: "atc5", classification: "mapped", count: data.cipCount },
            { name: "rows", classification: "retained-as-metadata", count: data.rows },
          ],
          unknownFields: data.unknownColumns.map((c) => `header.${c}`),
        },
      ],
    };
  }

  qualityReport(catalogue: Catalogue): MappingCoverageReport {
    return (
      catalogue.mappingCoverage.find((m) => m.sourceId === SOURCE_ID) ?? {
        sourceId: SOURCE_ID,
        fields: [],
        unknownFields: [],
      }
    );
  }
}

export interface OpenMedicParsed {
  /** Calendar year the edition covers (OPEN_MEDIC_2025.CSV → 2025). */
  edition?: number;
  /** CIP13 (13 digits) → full ATC code. First row wins; source is consistent per CIP. */
  atcByCip: Map<string, string>;
  rows: number;
  cipCount: number;
  unknownColumns: string[];
}

const KNOWN_HEADERS = new Set(
  [
    "atc1",
    "l_atc1",
    "atc2",
    "l_atc2",
    "atc3",
    "l_atc3",
    "atc4",
    "l_atc4",
    "atc5",
    "l_atc5",
    "cip13",
    "l_cip13",
    "top_gen",
    "gen_num",
    "age",
    "sexe",
    "ben_reg",
    "psp_spe",
    "boites",
    "rem",
    "bse",
  ].map((h) => h.toLowerCase()),
);

/** Stream the per-CIP13 × age × sex × region spending rows down to CIP13 → ATC. */
export async function parseOpenMedicCsv(
  file: string,
): Promise<{ atcByCip: Map<string, string>; rows: number; unknownColumns: string[] }> {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "latin1" }),
    crlfDelay: Infinity,
  });
  const atcByCip = new Map<string, string>();
  const unknownColumns: string[] = [];
  let rows = 0;
  let atcIdx = -1;
  let cipIdx = -1;
  let headerSeen = false;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cells = line.split(";");
    if (!headerSeen) {
      headerSeen = true;
      const lower = cells.map((c) => c.trim().toLowerCase());
      atcIdx = lower.indexOf("atc5");
      cipIdx = lower.indexOf("cip13");
      if (atcIdx === -1 || cipIdx === -1) {
        throw new Error(`Open Medic CSV header lacks ATC5/CIP13 columns: ${line.slice(0, 200)}`);
      }
      for (const cell of lower) {
        if (cell && !KNOWN_HEADERS.has(cell) && !unknownColumns.includes(cell)) unknownColumns.push(cell);
      }
      continue;
    }
    rows += 1;
    const atc = (cells[atcIdx] ?? "").trim();
    const cip = (cells[cipIdx] ?? "").trim();
    if (!/^\d{13}$/.test(cip)) continue;
    if (!/^[A-Z]\d{2}[A-Z]{2}\d{2}$/i.test(atc)) continue;
    if (!atcByCip.has(cip)) atcByCip.set(cip, atc.toUpperCase());
  }
  if (rows === 0) throw new Error("Open Medic CSV contains no data rows");
  return { atcByCip, rows, unknownColumns };
}

/**
 * Attach ATC to products: a product gets the code when every matched
 * presentation agrees on it. Disagreements are counted, never guessed.
 */
export function applyOpenMedic(catalogue: Catalogue, parsed: OpenMedicParsed, snapshot: SourceSnapshot): void {
  void snapshot; // provenance is the mapping-coverage entry; products carry no fieldProvenance
  const atcByProduct = new Map<string, Map<string, number>>();
  for (const pkg of catalogue.packages) {
    const atc = parsed.atcByCip.get(pkg.authorityKey);
    if (!atc) continue;
    const counts = atcByProduct.get(pkg.medicinalProductId) ?? new Map<string, number>();
    counts.set(atc, (counts.get(atc) ?? 0) + 1);
    atcByProduct.set(pkg.medicinalProductId, counts);
  }
  let applied = 0;
  let mismatched = 0;
  for (const mp of catalogue.medicinalProducts) {
    const atcs = atcByProduct.get(mp.id);
    if (!atcs || atcs.size === 0) continue;
    if (atcs.size === 1) {
      const atc = [...atcs.keys()][0]!;
      if (!mp.identifiers.some((i) => i.system === WHO_ATC_SYSTEM && i.value === atc)) {
        mp.identifiers.push({ system: WHO_ATC_SYSTEM, value: atc });
        applied += 1;
      }
    } else {
      mismatched += 1;
    }
  }
  const coverage = catalogue.mappingCoverage.find((m) => m.sourceId === SOURCE_ID);
  if (coverage) {
    coverage.fields.push({ name: "atc-applied", classification: "mapped", count: applied });
    if (mismatched) {
      coverage.fields.push({ name: "atc-mismatch", classification: "intentionally-ignored", count: mismatched });
    }
  }
}

export function openMedicDownloadPage(edition: number): string {
  return `${DOWNLOAD_HOST}/medicaments/download.php?Dir_Rep=Open_MEDIC_Base_Complete&Annee=${edition}`;
}

/** The download page is an HTML index with a tokenized file link; resolve it. */
export function extractOpenMedicZipUrl(page: Buffer, pageUrl: string): string | undefined {
  const html = page.toString("latin1");
  const match = /href="([^"]*download_file\.php[^"]*file=Open_MEDIC_Base_Complete\/OPEN_MEDIC_\d{4}\.zip[^"]*)"/i.exec(
    html,
  );
  if (!match?.[1]) return undefined;
  return new URL(match[1], pageUrl).href;
}

function snapshotFrom(
  buf: Buffer,
  ctx: AdapterContext,
  uri: string,
  sourceEffectiveDate?: string,
): SourceSnapshot {
  return {
    id: sha256(buf).slice(0, 16),
    sourceId: SOURCE_ID,
    identityAuthority: "openmedic",
    retrievedAt: new Date().toISOString(),
    sourceEffectiveDate: sourceEffectiveDate ?? ctx.cutoffDate,
    sha256: sha256(buf),
    uri,
    ...snapshotTerms(loadSourceDescriptor(ADAPTER_DIR)),
  };
}

function listCsv(dir: string): string[] {
  const found = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".csv"));
  if (found.length === 0) throw new Error("Open Medic archive contains no CSV file");
  return found.map((f) => path.join(dir, f));
}
