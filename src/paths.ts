import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (parent of src/). */
export const REPO_ROOT = path.resolve(here, "..");

export function repoPath(...parts: string[]): string {
  return path.join(REPO_ROOT, ...parts);
}
