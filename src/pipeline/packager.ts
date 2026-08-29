import fs from "node:fs";
import path from "node:path";
import type { Catalogue } from "../canonical/types.js";
import { FHIR_CANONICAL_BASE } from "../constants.js";
import { GITHUB_REPO } from "../constants.js";
import { exportR4 } from "../fhir/r4.js";
import { exportR5 } from "../fhir/r5.js";
import { writeSqlite } from "../sqlite/writer.js";
import { repoPath } from "../paths.js";
import { sha256, writeDeterministicZip } from "../security.js";
import { writeJson, type QualityReport, type ChangeReport } from "./quality.js";

function loadPins(): unknown {
  return JSON.parse(fs.readFileSync(repoPath("tooling/pins.json"), "utf8"));
}

export interface PackagerInput {
  catalogue: Catalogue;
  outDir: string;
  releaseLabel: string;
  artifactId: string;
  rawSourceZips: { name: string; data: Buffer }[];
  quality: QualityReport;
  changes?: ChangeReport;
  licensingTexts: { name: string; text: string }[];
}

export async function writeRelease(input: PackagerInput): Promise<{ zipPath: string; sha256: string }> {
  const root = input.outDir;
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "database"), { recursive: true });
  fs.mkdirSync(path.join(root, "fhir-r4"), { recursive: true });
  fs.mkdirSync(path.join(root, "fhir-r5"), { recursive: true });
  fs.mkdirSync(path.join(root, "licensing"), { recursive: true });

  writeSqlite(input.catalogue, path.join(root, "database", "medication.sqlite"));
  const r4 = exportR4(input.catalogue, `${input.artifactId}-${input.releaseLabel}`);
  const r5 = exportR5(input.catalogue, `${input.artifactId}-${input.releaseLabel}`);
  for (const [name, body] of Object.entries(r4)) {
    fs.writeFileSync(path.join(root, "fhir-r4", name), body);
  }
  for (const [name, body] of Object.entries(r5)) {
    fs.writeFileSync(path.join(root, "fhir-r5", name), body);
  }

  const manifest = {
    artifactId: input.artifactId,
    release: input.releaseLabel,
    jurisdiction: input.catalogue.jurisdiction,
    schema: {
      canonical: input.catalogue.schemaVersion,
      fhirR4: "0.1.0",
      fhirR5: "0.1.0",
    },
    generatorVersion: input.catalogue.generatorVersion,
    canonicalBase: FHIR_CANONICAL_BASE,
    pins: loadPins(),
    githubRepo: GITHUB_REPO,
    sources: input.catalogue.sourceSnapshots.map((s) => ({
      id: s.sourceId,
      identityAuthority: s.identityAuthority,
      sourceEffectiveDate: s.sourceEffectiveDate,
      retrievedAt: s.retrievedAt,
      sha256: s.sha256,
      uri: s.uri,
    })),
  };
  writeJson(path.join(root, "manifest.json"), manifest);
  writeJson(path.join(root, "quality-report.json"), input.quality);
  writeJson(path.join(root, "changes.json"), input.changes ?? { note: "no previous release" });

  for (const lic of input.licensingTexts) {
    fs.writeFileSync(path.join(root, "licensing", lic.name), lic.text);
  }

  const files: { name: string; data: Buffer }[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, rel);
      else files.push({ name: rel, data: fs.readFileSync(full) });
    }
  };
  walk(root, "");
  for (const raw of input.rawSourceZips) {
    files.push({ name: `source/${raw.name}`, data: raw.data });
    fs.mkdirSync(path.join(root, "source"), { recursive: true });
    fs.writeFileSync(path.join(root, "source", raw.name), raw.data);
  }

  const checksumLines = files
    .map((f) => `${sha256(f.data)}  ${f.name}`)
    .sort();
  const checksums = `${checksumLines.join("\n")}\n`;
  fs.writeFileSync(path.join(root, "checksums.sha256"), checksums);
  files.push({ name: "checksums.sha256", data: Buffer.from(checksums) });

  const zipPath = path.join(path.dirname(root), `${input.artifactId}-${input.releaseLabel}.zip`);
  await writeDeterministicZip(files, zipPath);
  return { zipPath, sha256: sha256(fs.readFileSync(zipPath)) };
}

export function updateCatalogJson(
  catalogPath: string,
  artifactId: string,
  releaseLabel: string,
): void {
  let doc: { artifacts: Record<string, { latest: string; tag: string; url: string; manifest: string }> } = {
    artifacts: {},
  };
  if (fs.existsSync(catalogPath)) {
    doc = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as typeof doc;
  }
  const tag = `${artifactId}-${releaseLabel}`;
  const base = `https://github.com/${GITHUB_REPO}/releases`;
  doc.artifacts[artifactId] = {
    latest: releaseLabel,
    tag,
    url: `${base}/tag/${tag}`,
    manifest: `${base}/download/${tag}/manifest.json`,
  };
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  fs.writeFileSync(catalogPath, `${JSON.stringify(doc, null, 2)}\n`);
}

