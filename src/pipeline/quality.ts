import fs from "node:fs";
import path from "node:path";
import type { Catalogue } from "../canonical/types.js";

export interface QualityReport {
  artifactId: string;
  release?: string;
  sourceRecordCounts: Record<string, number>;
  productGroupCount: number;
  medicinalProductCount: number;
  packageCount: number;
  organizationCount: number;
  percentPackagesWithAuthoritativeId: number;
  percentPackagesWithGtin: number;
  percentProductsWithIngredients: number;
  percentProductsWithDoseForm: number;
  percentProductsWithAtc: number;
  percentPackagesWithMarketingStatus: number;
  unknownFields: string[];
  sourceFreshness: { sourceId: string; sourceEffectiveDate?: string; retrievedAt: string }[];
}

export function qualityReport(catalogue: Catalogue): QualityReport {
  const pkgs = catalogue.packages;
  const mps = catalogue.medicinalProducts;
  const withGtin = pkgs.filter((p) => p.gtin).length;
  const withAuth = pkgs.filter((p) => p.identifiers.length > 0).length;
  const withIng = mps.filter((p) => p.ingredients.length > 0).length;
  const withForm = mps.filter((p) => p.doseForm).length;
  const withAtc = catalogue.productGroups.filter((g) => g.atc).length;
  const withMkt = pkgs.filter((p) => p.marketingStatus).length;
  const unknown = catalogue.mappingCoverage.flatMap((m) => m.unknownFields.map((f) => `${m.sourceId}:${f}`));
  const counts: Record<string, number> = {};
  for (const s of catalogue.sourceSnapshots) counts[s.sourceId] = (counts[s.sourceId] ?? 0) + 1;
  return {
    artifactId: catalogue.artifactId,
    release: catalogue.release,
    sourceRecordCounts: {
      ...counts,
      productGroups: catalogue.productGroups.length,
      packages: pkgs.length,
    },
    productGroupCount: catalogue.productGroups.length,
    medicinalProductCount: mps.length,
    packageCount: pkgs.length,
    organizationCount: catalogue.organizations.length,
    percentPackagesWithAuthoritativeId: pct(withAuth, pkgs.length),
    percentPackagesWithGtin: pct(withGtin, pkgs.length),
    percentProductsWithIngredients: pct(withIng, mps.length),
    percentProductsWithDoseForm: pct(withForm, mps.length),
    percentProductsWithAtc: pct(withAtc, catalogue.productGroups.length),
    percentPackagesWithMarketingStatus: pct(withMkt, pkgs.length),
    unknownFields: unknown,
    sourceFreshness: catalogue.sourceSnapshots.map((s) => ({
      sourceId: s.sourceId,
      sourceEffectiveDate: s.sourceEffectiveDate,
      retrievedAt: s.retrievedAt,
    })),
  };
}

export function detectAnomalies(current: QualityReport, previous?: QualityReport): string[] {
  const out: string[] = [];
  if (previous && previous.packageCount > 0) {
    if (current.packageCount < previous.packageCount * 0.5) {
      out.push(`package count dropped from ${previous.packageCount} to ${current.packageCount}`);
    }
  }
  if (previous && previous.percentPackagesWithGtin > 10 && current.percentPackagesWithGtin === 0) {
    out.push("all GTINs disappeared");
  }
  if (current.unknownFields.length > 0) {
    out.push(`unknown source fields: ${current.unknownFields.join(", ")}`);
  }
  return out;
}

export interface ChangeReport {
  productsAdded: number;
  productsRemoved: number;
  packagesAdded: number;
  packagesRemoved: number;
  addedPackageIds: string[];
  removedPackageIds: string[];
}

export function diffCatalogues(prev: Catalogue, next: Catalogue): ChangeReport {
  const prevP = new Set(prev.medicinalProducts.map((p) => p.authorityKey));
  const nextP = new Set(next.medicinalProducts.map((p) => p.authorityKey));
  const prevK = new Set(prev.packages.map((p) => p.authorityKey));
  const nextK = new Set(next.packages.map((p) => p.authorityKey));
  const added = [...nextK].filter((k) => !prevK.has(k));
  const removed = [...prevK].filter((k) => !nextK.has(k));
  return {
    productsAdded: [...nextP].filter((k) => !prevP.has(k)).length,
    productsRemoved: [...prevP].filter((k) => !nextP.has(k)).length,
    packagesAdded: added.length,
    packagesRemoved: removed.length,
    addedPackageIds: added.sort(),
    removedPackageIds: removed.sort(),
  };
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function pct(n: number, d: number): number {
  if (d === 0) return 0;
  return Math.round((n / d) * 1000) / 10;
}
