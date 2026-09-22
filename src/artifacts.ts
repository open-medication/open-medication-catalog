import fs from "node:fs";
import YAML from "yaml";
import { repoPath } from "./paths.js";

export type MedicinalProductDomainCode = "Human" | "Veterinary";

export interface ArtifactRecipe {
  id: string;
  jurisdiction: string;
  domain?: MedicinalProductDomainCode;
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
      domain: spec.domain,
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
      `Unknown artifact '${id}'. Official builds use recipe ids from artifacts.yaml (e.g. ch-base, ch-vet-base, ch-enriched, fr-base, pl-base, pl-vet-base, us-base).`,
    );
  }
  return recipe;
}

export const OFFICIAL_ARTIFACT_IDS = [...loadRecipes().keys()].sort();

export function isOfficialArtifactId(id: string): boolean {
  return loadRecipes().has(id);
}
