import { CANONICAL_SCHEMA_VERSION, type Catalogue } from "../canonical/types.js";
import { assertPackageCodeUniqueWithinAuth } from "./ch/swissmedic.js";
import { applyRefdata, type RefdataArticle } from "./ch/refdata.js";
import { applyBag, type FhirResource } from "./ch/bag.js";
import type { PartialCatalogue } from "./types.js";

export function emptyCatalogue(artifactId: string, jurisdiction: string, generatorVersion: string): Catalogue {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    artifactId,
    jurisdiction,
    generatorVersion,
    productGroups: [],
    medicinalProducts: [],
    packages: [],
    organizations: [],
    authorizations: [],
    substances: [],
    reimbursements: [],
    sourceSnapshots: [],
    mappingCoverage: [],
  };
}

/** Append without `push(...)`, which overflows the stack past ~100k arguments. */
function appendAll<T>(target: T[], items: readonly T[]): void {
  for (const item of items) target.push(item);
}

export function mergePartials(base: Catalogue, part: PartialCatalogue): void {
  appendAll(base.productGroups, part.productGroups);
  appendAll(base.medicinalProducts, part.medicinalProducts);
  appendAll(base.packages, part.packages);
  appendAll(base.organizations, part.organizations);
  appendAll(base.authorizations, part.authorizations);
  appendAll(base.substances, part.substances);
  appendAll(base.reimbursements, part.reimbursements);
  appendAll(base.sourceSnapshots, part.sourceSnapshots);
  appendAll(base.mappingCoverage, part.mappingCoverage);
}

export function finalizeSwissmedic(catalogue: Catalogue): void {
  sortCatalogue(catalogue);
  assertPackageCodeUniqueWithinAuth(catalogue.packages);
}

export function enrichWithRefdata(catalogue: Catalogue, articles: RefdataArticle[], snapshotId: string): void {
  const snap = catalogue.sourceSnapshots.find((s) => s.id === snapshotId);
  if (!snap) throw new Error("Refdata snapshot missing");
  applyRefdata(catalogue, articles, snap);
}

export function enrichWithBag(catalogue: Catalogue, resources: FhirResource[], snapshotId: string): void {
  const snap = catalogue.sourceSnapshots.find((s) => s.id === snapshotId);
  if (!snap) throw new Error("BAG snapshot missing");
  applyBag(catalogue, resources, snap);
}

export function sortCatalogue(catalogue: Catalogue): void {
  const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
  catalogue.productGroups.sort(byId);
  catalogue.medicinalProducts.sort(byId);
  catalogue.packages.sort(byId);
  catalogue.organizations.sort(byId);
  catalogue.authorizations.sort(byId);
  catalogue.substances.sort(byId);
  catalogue.reimbursements.sort((a, b) => a.packageId.localeCompare(b.packageId));
}
