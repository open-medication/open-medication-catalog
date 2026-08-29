import type { Catalogue } from "./types.js";
import { CANONICAL_SCHEMA_VERSION } from "./types.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateCatalogue(catalogue: Catalogue): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (catalogue.schemaVersion !== CANONICAL_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      message: `expected ${CANONICAL_SCHEMA_VERSION}, got ${catalogue.schemaVersion}`,
    });
  }

  const ids = new Set<string>();
  const remember = (id: string, path: string) => {
    if (ids.has(id)) issues.push({ path, message: `duplicate canonical id ${id}` });
    ids.add(id);
  };

  const groupIds = new Set(catalogue.productGroups.map((g) => g.id));
  const productIds = new Set(catalogue.medicinalProducts.map((p) => p.id));
  const orgIds = new Set(catalogue.organizations.map((o) => o.id));

  for (const g of catalogue.productGroups) {
    remember(g.id, `productGroups/${g.id}`);
    if (typeof g.authorityKey !== "string") {
      issues.push({ path: `productGroups/${g.id}/authorityKey`, message: "must be string" });
    }
  }
  for (const p of catalogue.medicinalProducts) {
    remember(p.id, `medicinalProducts/${p.id}`);
    if (p.productGroupId && !groupIds.has(p.productGroupId)) {
      issues.push({
        path: `medicinalProducts/${p.id}/productGroupId`,
        message: "unknown ProductGroup",
      });
    }
    if (typeof p.authorityKey !== "string") {
      issues.push({ path: `medicinalProducts/${p.id}/authorityKey`, message: "must be string" });
    }
  }
  for (const pkg of catalogue.packages) {
    remember(pkg.id, `packages/${pkg.id}`);
    if (!productIds.has(pkg.medicinalProductId)) {
      issues.push({
        path: `packages/${pkg.id}/medicinalProductId`,
        message: "unknown MedicinalProduct",
      });
    }
    if (typeof pkg.authorityKey !== "string") {
      issues.push({ path: `packages/${pkg.id}/authorityKey`, message: "must be string" });
    }
  }
  for (const org of catalogue.organizations) {
    remember(org.id, `organizations/${org.id}`);
  }
  for (const auth of catalogue.authorizations) {
    remember(auth.id, `authorizations/${auth.id}`);
    if (auth.holderId && !orgIds.has(auth.holderId)) {
      issues.push({
        path: `authorizations/${auth.id}/holderId`,
        message: "unknown Organization",
      });
    }
    for (const mpId of auth.medicinalProductIds) {
      if (!productIds.has(mpId)) {
        issues.push({
          path: `authorizations/${auth.id}/medicinalProductIds`,
          message: `unknown MedicinalProduct ${mpId}`,
        });
      }
    }
  }
  return issues;
}

export function assertValidCatalogue(catalogue: Catalogue): void {
  const issues = validateCatalogue(catalogue);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.path}: ${i.message}`).join("\n");
    throw new Error(`Canonical schema/integrity errors:\n${detail}`);
  }
}
