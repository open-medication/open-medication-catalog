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

/** Resources drawn from each NDJSON file. Smaller files are validated in full. */
export const FHIR_VALIDATION_SAMPLE = 200;

/** Evenly spaced indexes, including the first and last line. */
export function spreadIndices(count: number, sampleSize: number): number[] {
  if (sampleSize <= 0 || count <= 0) return [];
  if (count <= sampleSize) return Array.from({ length: count }, (_, i) => i);
  const last = sampleSize - 1;
  const indices: number[] = [];
  for (let i = 0; i < sampleSize; i++) indices.push(Math.floor((i * (count - 1)) / last));
  return indices;
}

/**
 * Walk NDJSON one line at a time. The file is never assembled into one string,
 * so a national dump can exceed Node's string limit.
 */
function scanNdjsonLines(file: string, onLine: (line: string, index: number) => void): number {
  const fd = fs.openSync(file, "r");
  const decoder = new TextDecoder("utf8");
  let carry = "";
  let index = 0;
  const buf = Buffer.alloc(64 * 1024);
  const emit = (raw: string) => {
    const line = raw.replace(/\r$/, "").trim();
    if (!line) return;
    onLine(line, index);
    index += 1;
  };
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) {
        carry += decoder.decode();
        if (carry) emit(carry);
        break;
      }
      carry += decoder.decode(buf.subarray(0, n), { stream: true });
      let nl = carry.indexOf("\n");
      while (nl !== -1) {
        emit(carry.slice(0, nl));
        carry = carry.slice(nl + 1);
        nl = carry.indexOf("\n");
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return index;
}

function spreadNdjsonLines(file: string, sampleSize: number): string[] {
  if (sampleSize <= 0) return [];
  const count = scanNdjsonLines(file, () => {});
  const wanted = new Set(spreadIndices(count, sampleSize));
  const picked: string[] = [];
  scanNdjsonLines(file, (line, index) => {
    if (wanted.has(index)) picked.push(line);
  });
  return picked;
}

/** Materialise a spread of `maxResources` NDJSON lines as JSON files for the Java validator. */
export function materialiseNdjson(ndjsonPath: string, destDir: string, maxResources: number): string[] {
  const lines = spreadNdjsonLines(ndjsonPath, maxResources);
  fs.mkdirSync(destDir, { recursive: true });
  const written: string[] = [];
  for (const line of lines) {
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

const FHIR_NDJSON_GROUPS = [
  { dirName: "fhir-r4", version: "4.0.1", igSubdir: "fhir/r4/fsh-generated/resources" },
  { dirName: "fhir-r5", version: "5.0.0", igSubdir: "fhir/r5/fsh-generated/resources" },
] as const;

/** NDJSON files under `fhir-r4/` and `fhir-r5/`, grouped by FHIR version. */
export function listReleaseFhirNdjson(releaseDir: string): {
  dirName: string;
  version: string;
  igSubdir: string;
  ndjsonPaths: string[];
}[] {
  return FHIR_NDJSON_GROUPS.map((group) => {
    const dir = path.join(releaseDir, group.dirName);
    const ndjsonPaths = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((name) => name.endsWith(".ndjson"))
          .sort()
          .map((name) => path.join(dir, name))
      : [];
    return { ...group, ndjsonPaths };
  }).filter((group) => group.ndjsonPaths.length > 0);
}

export function validateReleaseFhir(opts: {
  releaseDir: string;
  jar: string;
  maxResources?: number;
}): void {
  const max = opts.maxResources ?? FHIR_VALIDATION_SAMPLE;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omc-fhir-"));
  const groups = listReleaseFhirNdjson(opts.releaseDir);
  let ran = 0;
  for (const group of groups) {
    const files = group.ndjsonPaths.flatMap((ndjsonPath) =>
      materialiseNdjson(ndjsonPath, path.join(tmp, group.dirName, path.basename(ndjsonPath, ".ndjson")), max),
    );
    if (files.length === 0) continue;
    runValidator({
      jar: opts.jar,
      files,
      version: group.version,
      igDir: requireIgDir(repoPath(group.igSubdir)),
    });
    ran += 1;
  }
  if (ran === 0) {
    throw new Error(
      `No FHIR NDJSON under ${opts.releaseDir} (expected *.ndjson in fhir-r4/ and/or fhir-r5/)`,
    );
  }
}
