import fs from "node:fs";
import YAML from "yaml";
import { repoPath } from "./paths.js";

export interface ArtifactRecipe {
  id: string;
  jurisdiction: string;
  requiredSources: string[];
  requiredArtifacts?: string[];
  attachRawSources: string[];
}

export interface ArtifactFile {
  schemaVersion: string;
  artifacts: Record<string, Omit<ArtifactRecipe, "id">>;
}

export function loadRecipes(file = repoPath("artifacts.yaml")): Map<string, ArtifactRecipe> {
  const parsed = YAML.parse(fs.readFileSync(file, "utf8")) as ArtifactFile;
  const out = new Map<string, ArtifactRecipe>();
  for (const [id, spec] of Object.entries(parsed.artifacts)) {
    out.set(id, {
      id,
      jurisdiction: spec.jurisdiction,
      requiredSources: spec.requiredSources ?? [],
      requiredArtifacts: spec.requiredArtifacts,
      attachRawSources: spec.attachRawSources ?? [],
    });
  }
  return out;
}

export function getRecipe(id: string): ArtifactRecipe {
  const recipe = loadRecipes().get(id);
  if (!recipe) {
    throw new Error(
      `Unknown artifact '${id}'. Official builds use recipe ids from artifacts.yaml (e.g. ch-base, ch-enriched).`,
    );
  }
  return recipe;
}

export const OFFICIAL_ARTIFACT_IDS = ["ch-base", "ch-enriched"] as const;

export function isOfficialArtifactId(id: string): boolean {
  return loadRecipes().has(id);
}
