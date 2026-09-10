import fs from "node:fs";
import path from "node:path";
import { getRecipe, isOfficialArtifactId, type ArtifactRecipe } from "../artifacts.js";
import { emptyCatalogue, enrichWithBag, enrichWithRefdata, finalizeSwissmedic, mergePartials } from "../adapters/compose.js";
import { SwissmedicAdapter, SourceNotYetAvailableError } from "../adapters/ch/swissmedic.js";
import { RefdataAdapter } from "../adapters/ch/refdata.js";
import { BagAdapter, loadFhirResources } from "../adapters/ch/bag.js";
import type { Adapter, AdapterContext, FetchResult } from "../adapters/types.js";
import { assertValidCatalogue } from "../canonical/validate.js";
import { repoPath } from "../paths.js";
import { calendarForDate, parseDataMonth, type ReleaseCalendar } from "./dates.js";
import { detectAnomalies, diffCatalogues, qualityReport, type ChangeReport } from "./quality.js";
import { writeRelease } from "./packager.js";
import { assertTermsAllowRedistribution } from "./terms.js";
import { licensingTexts } from "./licensing.js";
import type { Catalogue } from "../canonical/types.js";

const GENERATOR_VERSION = "0.1.0";

export interface BuildOptions {
  artifactId?: string;
  jurisdiction?: string;
  sources?: string[];
  inputBySource?: Record<string, string>;
  outDir?: string;
  dataMonth?: string;
  previousDir?: string;
  publishOfficial?: boolean;
  enableBag?: boolean;
}

export interface BuildResult {
  catalogue: Catalogue;
  zipPath: string;
  sha256: string;
  notYetAvailable?: boolean;
  official: boolean;
}

const adapters: Record<string, Adapter> = {
  swissmedic: new SwissmedicAdapter(),
  refdata: new RefdataAdapter(),
  bag: new BagAdapter(),
};

export async function build(opts: BuildOptions): Promise<BuildResult> {
  const wantBag = Boolean(opts.enableBag) || process.env.OMC_ENABLE_BAG === "1";
  if (wantBag && opts.sources?.length) {
    throw new Error("--enable-bag is only valid for omc build ch-enriched (not --source)");
  }
  if (wantBag && opts.artifactId !== "ch-enriched") {
    throw new Error("--enable-bag is only valid for omc build ch-enriched");
  }

  const official = Boolean(opts.artifactId && isOfficialArtifactId(opts.artifactId) && !opts.sources && !wantBag);
  if (opts.publishOfficial && !official) {
    throw new Error(
      wantBag
        ? "BAG-enriched builds cannot be published as an official artifact"
        : "Custom --source builds cannot be published under an official artifact identity",
    );
  }

  let recipe: ArtifactRecipe | undefined;
  let sourceIds: string[];
  let artifactId: string;
  let jurisdiction: string;
  if (opts.artifactId && !opts.sources) {
    recipe = getRecipe(opts.artifactId);
    sourceIds = [...recipe.requiredSources];
    artifactId = recipe.id;
    jurisdiction = recipe.jurisdiction;
    if (wantBag) {
      if (!sourceIds.includes("refdata")) {
        throw new Error("--enable-bag requires swissmedic + refdata (ch-enriched)");
      }
      if (!sourceIds.includes("bag")) sourceIds.push("bag");
    }
  } else if (opts.sources?.length) {
    sourceIds = opts.sources;
    artifactId = `custom-${(opts.jurisdiction ?? "CH").toLowerCase()}`;
    jurisdiction = opts.jurisdiction ?? "CH";
  } else {
    throw new Error("Specify an artifact id (omc build ch-base) or --source for a custom local build");
  }

  const cal: ReleaseCalendar = opts.dataMonth ? parseDataMonth(opts.dataMonth) : calendarForDate();
  const outDir = opts.outDir ?? repoPath("output", artifactId);
  const cacheDir = path.join(outDir, ".cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  if (official && process.env.OMC_SKIP_TERMS !== "1") {
    await assertTermsAllowRedistribution(sourceIds);
  }

  const ctxBase = (sourceId: string): AdapterContext => ({
    cacheDir,
    inputPath: opts.inputBySource?.[sourceId],
    secrets: { REFDATA_API_KEY: process.env.REFDATA_API_KEY },
    releaseMonth: cal.dataMonth,
    cutoffDate: cal.cutoffDate,
    archiveMonth: cal.archiveMonth,
  });

  const catalogue = emptyCatalogue(artifactId, jurisdiction, GENERATOR_VERSION);
  catalogue.release = cal.dataMonth;

  const fetched = new Map<string, FetchResult>();
  const parsed = new Map<string, unknown>();

  for (const sourceId of sourceIds) {
    const adapter = adapters[sourceId];
    if (!adapter) throw new Error(`No adapter registered for ${sourceId}`);
    const ctx = ctxBase(sourceId);
    let fetchResult: FetchResult;
    try {
      fetchResult = await adapter.fetch(ctx);
    } catch (err) {
      if (err instanceof SourceNotYetAvailableError) {
        return { catalogue, zipPath: "", sha256: "", notYetAvailable: true, official };
      }
      throw err;
    }
    await adapter.validateSource(ctx, fetchResult);
    const p = await adapter.parse(ctx, fetchResult);
    parsed.set(sourceId, p);
    fetched.set(sourceId, fetchResult);
    const part = await adapter.normalize(ctx, p, fetchResult.snapshot);
    mergePartials(catalogue, part);
  }

  if (sourceIds.includes("swissmedic")) finalizeSwissmedic(catalogue);
  if (sourceIds.includes("refdata")) {
    const snap = fetched.get("refdata")!.snapshot;
    enrichWithRefdata(catalogue, parsed.get("refdata") as never, snap.id);
  }
  if (sourceIds.includes("bag")) {
    const snap = fetched.get("bag")!.snapshot;
    enrichWithBag(catalogue, loadFhirResources(fetched.get("bag")!.files), snap.id);
  }

  assertValidCatalogue(catalogue);
  const quality = qualityReport(catalogue);
  const anomalies = detectAnomalies(quality);
  if (anomalies.length && official && quality.unknownFields.length > 0 && quality.packageCount === 0) {
    throw new Error(`Anomaly gate: ${anomalies.join("; ")}`);
  }

  let changes: ChangeReport | undefined;
  if (opts.previousDir) {
    const prevFile = path.join(opts.previousDir, "canonical.json");
    if (fs.existsSync(prevFile)) {
      changes = diffCatalogues(JSON.parse(fs.readFileSync(prevFile, "utf8")) as Catalogue, catalogue);
    }
  }

  const staging = path.join(outDir, "release");
  const rawZips: { name: string; data: Buffer }[] = [];
  const attach = recipe?.attachRawSources ?? [];
  for (const sid of attach) {
    if (sid === "refdata") continue;
    const raw = fetched.get(sid)?.rawArchivePath;
    if (raw && fs.existsSync(raw)) {
      rawZips.push({ name: path.basename(raw), data: fs.readFileSync(raw) });
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "canonical.json"), `${JSON.stringify(catalogue)}\n`);

  const packed = await writeRelease({
    catalogue,
    outDir: staging,
    releaseLabel: cal.dataMonth,
    artifactId,
    rawSourceZips: rawZips,
    quality,
    changes,
    licensingTexts: licensingTexts(catalogue.sourceSnapshots, attach),
  });

  return { catalogue, zipPath: packed.zipPath, sha256: packed.sha256, official };
}
