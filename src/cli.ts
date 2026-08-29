#!/usr/bin/env node
import { Command } from "commander";
import { build } from "./pipeline/build.js";
import { searchPackages } from "./sqlite/writer.js";
import { isOfficialArtifactId } from "./artifacts.js";
import { SourceNotYetAvailableError } from "./adapters/ch/swissmedic.js";
import { rebuildCatalogFromGithubReleases } from "./pipeline/packager.js";
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
  .action(async (target: string, opts: {
    source: string[];
    input: string[];
    out?: string;
    month?: string;
    previous?: string;
    publish?: boolean;
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
  .command("catalog")
  .description("Rebuild pages/catalog.json from published GitHub Releases (all official artifacts)")
  .option("--write <path>", "output path", "pages/catalog.json")
  .action(async (opts: { write: string }) => {
    const doc = await rebuildCatalogFromGithubReleases(path.resolve(opts.write));
    console.log(`wrote ${opts.write} artifacts=${Object.keys(doc.artifacts).join(",") || "(none)"}`);
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
