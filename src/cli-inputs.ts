import path from "node:path";
import { isOfficialArtifactId, getRecipe } from "./artifacts.js";

/**
 * Map `--input` values to source ids.
 * `source=path` always maps explicitly. A bare path maps to the recipe's
 * primary source, or — for a custom single-`--source` build — to that source.
 */
export function parseInputs(
  input: string[] | undefined,
  artifactId?: string,
  customSources?: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const fallback = customSources?.length === 1 ? customSources[0]! : defaultInputSource(artifactId);
  for (const item of input ?? []) {
    const idx = item.indexOf("=");
    if (idx === -1) {
      out[fallback] = path.resolve(item);
    } else {
      out[item.slice(0, idx)] = path.resolve(item.slice(idx + 1));
    }
  }
  return out;
}

function defaultInputSource(artifactId?: string): string {
  if (artifactId && isOfficialArtifactId(artifactId)) {
    const sources = getRecipe(artifactId).requiredSources;
    if (sources[0]) return sources[0];
  }
  return "swissmedic";
}