import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoPath } from "../paths.js";
import { fetchBinary, sha256 } from "../security.js";

export interface ValidatorPins {
  version: string;
  url: string;
  sha256: string;
}

export function loadValidatorPins(): ValidatorPins {
  const pins = JSON.parse(fs.readFileSync(repoPath("tooling/pins.json"), "utf8")) as {
    validator: ValidatorPins;
  };
  if (!pins.validator.sha256 || pins.validator.sha256 === "PENDING_FIRST_DOWNLOAD") {
    throw new Error("tooling/pins.json is missing validator.sha256");
  }
  return pins.validator;
}

export async function ensureValidatorJar(): Promise<string> {
  const pin = loadValidatorPins();
  const dest = repoPath("tooling", "validator_cli.jar");
  if (fs.existsSync(dest) && sha256(fs.readFileSync(dest)) === pin.sha256) {
    return dest;
  }
  const buf = await fetchBinary(pin.url, { maxBytes: 400 * 1024 * 1024 });
  const actual = sha256(buf);
  if (actual !== pin.sha256) {
    throw new Error(`validator_cli.jar sha256 mismatch: expected ${pin.sha256}, got ${actual}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}

export function verifyPinnedJar(jarPath: string): void {
  const pin = loadValidatorPins();
  const actual = sha256(fs.readFileSync(jarPath));
  if (actual !== pin.sha256) {
    throw new Error(`validator_cli.jar sha256 mismatch: expected ${pin.sha256}, got ${actual}`);
  }
}

/** Materialise the first `maxResources` NDJSON lines as JSON files for the Java validator. */
export function materialiseNdjson(ndjsonPath: string, destDir: string, maxResources: number): string[] {
  const lines = fs.readFileSync(ndjsonPath, "utf8").split("\n").filter((l) => l.trim().length > 0);
  fs.mkdirSync(destDir, { recursive: true });
  const written: string[] = [];
  for (const line of lines.slice(0, maxResources)) {
    const res = JSON.parse(line) as { resourceType?: string; id?: string };
    const name = `${res.resourceType ?? "Resource"}-${res.id ?? written.length}.json`;
    const file = path.join(destDir, name);
    fs.writeFileSync(file, `${JSON.stringify(JSON.parse(line), null, 2)}\n`);
    written.push(file);
  }
  return written;
}

export function runValidator(opts: {
  jar: string;
  files: string[];
  version: string;
  igDir?: string;
}): void {
  if (opts.files.length === 0) throw new Error("No FHIR files to validate");
  const args = [
    "-jar",
    opts.jar,
    ...opts.files,
    "-version",
    opts.version,
    "-tx",
    "n/a",
    "-output-style",
    "compact",
  ];
  if (opts.igDir) args.push("-ig", opts.igDir);
  execFileSync("java", args, { stdio: "inherit", timeout: 10 * 60 * 1000 });
}

function requireIgDir(dir: string): string {
  if (!fs.existsSync(dir) || fs.readdirSync(dir).length === 0) {
    throw new Error(`SUSHI IG missing at ${dir}; run pnpm exec sushi fhir/r4 and fhir/r5 first`);
  }
  return dir;
}

export function validateReleaseFhir(opts: {
  releaseDir: string;
  jar: string;
  maxResources?: number;
}): void {
  const max = opts.maxResources ?? 20;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omc-fhir-"));
  const r4 = path.join(opts.releaseDir, "fhir-r4", "Medication.ndjson");
  const r5 = path.join(opts.releaseDir, "fhir-r5", "MedicinalProductDefinition.ndjson");
  let ran = 0;
  if (fs.existsSync(r4)) {
    const files = materialiseNdjson(r4, path.join(tmp, "r4"), max);
    runValidator({
      jar: opts.jar,
      files,
      version: "4.0.1",
      igDir: requireIgDir(repoPath("fhir/r4/fsh-generated/resources")),
    });
    ran += 1;
  }
  if (fs.existsSync(r5)) {
    const files = materialiseNdjson(r5, path.join(tmp, "r5"), max);
    runValidator({
      jar: opts.jar,
      files,
      version: "5.0.0",
      igDir: requireIgDir(repoPath("fhir/r5/fsh-generated/resources")),
    });
    ran += 1;
  }
  if (ran === 0) {
    throw new Error(`No FHIR NDJSON under ${opts.releaseDir} (expected fhir-r4/Medication.ndjson and/or fhir-r5/MedicinalProductDefinition.ndjson)`);
  }
}
