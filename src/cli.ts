#!/usr/bin/env node
import { Command } from "commander";
import { build } from "./pipeline/build.js";
import { searchPackages } from "./sqlite/writer.js";
import { isOfficialArtifactId } from "./artifacts.js";
import { SourceNotYetAvailableError } from "./adapters/ch/swissmedic.js";
import { rebuildCatalogFromGithubReleases } from "./pipeline/packager.js";
import { discoverNextDataMonth, formatNextMonthSummary, githubOutputLines } from "./pipeline/discover.js";
import { checkAllTerms } from "./pipeline/terms.js";
import { CATALOG_JSON_REL } from "./constants.js";
import { ensureValidatorJar, validateReleaseFhir } from "./pipeline/validator.js";
import fs from "node:fs";
import path from "node:path";

const program = new Command();
program.name("omc").description("Open Medication Catalogue generator").version("0.1.0");

function parseInputs(input: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of input ?? []) {
    const idx = item.indexOf("=");
    if (idx === -1) {
      out.swissmedic = path.resolve(item);
    } else {
      out[item.slice(0, idx)] = path.resolve(item.slice(idx + 1));
    }
  }
  return out;
}

program
  .command("build")
  .argument("<target>", "artifact id (ch-base, ch-enriched) or jurisdiction for custom builds")
  .option("--source <id>", "custom local source (repeatable); cannot publish as official", collect, [] as string[])
  .option("--input <spec>", "source=path or a Swissmedic zip", collect, [] as string[])
  .option("--out <dir>", "output directory")
  .option("--month <yyyy.mm>", "data release month")
  .option("--previous <dir>", "previous build dir for changes.json")
  .option("--publish", "attempt official publish (recipe builds only)", false)
  .option("--enable-bag", "local BAG SL enrichment for ch-enriched only; cannot publish", false)
  .action(async (target: string, opts: {
    source: string[];
    input: string[];
    out?: string;
    month?: string;
    previous?: string;
    publish?: boolean;
    enableBag?: boolean;
  }) => {
    const custom = opts.source.length > 0;
    if (custom && isOfficialArtifactId(target)) {
      throw new Error(
        `Refusing to combine official artifact '${target}' with --source. Use a custom jurisdiction (e.g. CH) for experimental builds.`,
      );
    }
    const result = await build({
      artifactId: custom ? undefined : target,
      jurisdiction: custom ? target : undefined,
      sources: custom ? opts.source : undefined,
      inputBySource: parseInputs(opts.input),
      outDir: opts.out,
      dataMonth: opts.month,
      previousDir: opts.previous,
      publishOfficial: opts.publish,
      enableBag: opts.enableBag,
    });
    if (result.notYetAvailable) {
      const markerDir = opts.out ?? path.resolve("output", target);
      fs.mkdirSync(markerDir, { recursive: true });
      fs.writeFileSync(path.join(markerDir, ".not-yet-available"), "not yet available\n");
      console.log("not yet available");
      process.exitCode = 0;
      return;
    }
    console.log(`built ${target} official=${result.official} zip=${result.zipPath} sha256=${result.sha256}`);
  });

program
  .command("fetch")
  .argument("<artifactId>")
  .option("--input <spec>", "source=path", collect, [] as string[])
  .option("--month <yyyy.mm>")
  .action(async (artifactId: string, opts: { input: string[]; month?: string }) => {
    await build({
      artifactId,
      inputBySource: parseInputs(opts.input),
      dataMonth: opts.month,
    });
  });

program
  .command("validate")
  .argument("<artifactId>")
  .option("--input <spec>", "source=path", collect, [] as string[])
  .option("--month <yyyy.mm>")
  .action(async (artifactId: string, opts: { input: string[]; month?: string }) => {
    const result = await build({
      artifactId,
      inputBySource: parseInputs(opts.input),
      dataMonth: opts.month,
    });
    if (result.notYetAvailable) {
      console.log("not yet available");
      return;
    }
    console.log(`validated ${result.catalogue.packages.length} packages`);
  });

program
  .command("diff")
  .argument("<artifactId>")
  .requiredOption("--previous <dir>")
  .option("--input <spec>", "source=path", collect, [] as string[])
  .option("--month <yyyy.mm>")
  .action(async (artifactId: string, opts: { previous: string; input: string[]; month?: string }) => {
    await build({
      artifactId,
      previousDir: opts.previous,
      inputBySource: parseInputs(opts.input),
      dataMonth: opts.month,
    });
  });

program
  .command("search")
  .argument("<db>")
  .argument("<query>")
  .action((db: string, query: string) => {
    const rows = searchPackages(db, query);
    console.log(JSON.stringify(rows, null, 2));
  });

program
  .command("next-month")
  .description("Find the newest unpublished Swissmedic archive newer than the last GitHub Release")
  .argument("<artifactId>")
  .option("--month <yyyy.mm>", "use this data month instead of discovering")
  .option("--github-output <path>", "append skip/month/tag fields for GitHub Actions")
  .action(async (artifactId: string, opts: { month?: string; githubOutput?: string }) => {
    const result = await discoverNextDataMonth({ artifactId, forcedMonth: opts.month });
    console.log(formatNextMonthSummary(result));
    if (opts.githubOutput) {
      fs.appendFileSync(opts.githubOutput, `${githubOutputLines(result)}\n`);
    }
  });

program
  .command("catalog")
  .description("Rebuild site/public/catalog.json from published GitHub Releases (all official artifacts)")
  .option("--write <path>", "output path", CATALOG_JSON_REL.join("/"))
  .action(async (opts: { write: string }) => {
    const doc = await rebuildCatalogFromGithubReleases(path.resolve(opts.write));
    console.log(`wrote ${opts.write} artifacts=${Object.keys(doc.artifacts).join(",") || "(none)"}`);
  });

program
  .command("terms")
  .description("Compare live terms pages to committed snapshots; exit 1 on material change")
  .action(async () => {
    const rows = await checkAllTerms();
    for (const t of rows) {
      const state = t.fetchError ? `fetch-error ${t.fetchError}` : t.changed ? "CHANGED" : "ok";
      console.log(`${t.sourceId}\t${state}\tstored=${t.storedChecksum ?? "-"}\tlive=${t.currentChecksum ?? "-"}`);
    }
    if (rows.some((t) => t.changed || t.fetchError || !t.storedChecksum)) {
      process.exitCode = 1;
    }
  });

program
  .command("fhir-validate")
  .description("Run the pinned HL7 Java validator over a release directory")
  .requiredOption("--dir <path>", "release directory containing fhir-r4/ and fhir-r5/")
  .option("--max <n>", "max resources per NDJSON file", "20")
  .action(async (opts: { dir: string; max: string }) => {
    const jar = await ensureValidatorJar();
    validateReleaseFhir({
      releaseDir: path.resolve(opts.dir),
      jar,
      maxResources: Number(opts.max),
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof SourceNotYetAvailableError) {
    console.log("not yet available");
    process.exit(0);
  }
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}
