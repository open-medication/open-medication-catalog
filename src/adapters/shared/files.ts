import fs from "node:fs";
import path from "node:path";
import { extractZip } from "../../security.js";

export function prepareExtractDir(work: string, name = "extracted"): string {
  const dest = path.join(work, name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  return dest;
}

/** Walk a directory tree deterministically (sorted entries). */
export function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const filePath = path.join(dir, name);
    if (fs.statSync(filePath).isDirectory()) out.push(...walkFiles(filePath));
    else out.push(filePath);
  }
  return out;
}

export function findFile(dir: string, name: string): string | undefined {
  const direct = path.join(dir, name);
  if (fs.existsSync(direct)) return direct;
  const found = fs.readdirSync(dir).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return found ? path.join(dir, found) : undefined;
}

export async function extractInputZip(inputPath: string, work: string, dest: string): Promise<string> {
  const buf = fs.readFileSync(inputPath);
  await extractZip(buf, dest);
  const archiveCopy = path.join(work, path.basename(inputPath));
  fs.copyFileSync(inputPath, archiveCopy);
  return archiveCopy;
}
