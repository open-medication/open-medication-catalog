import fs from "node:fs";
import path from "node:path";
import type { Catalogue, MappingCoverageReport } from "../canonical/types.js";
import { WHO_ATC_SYSTEM } from "../canonical/types.js";
import type { QualityGates } from "../artifacts.js";

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
  /** Per-source field mapping counts; a silently empty join is visible here. */
  mappingCoverage: MappingCoverageReport[];
  sourceFreshness: { sourceId: string; sourceEffectiveDate?: string; retrievedAt: string }[];
}

export function qualityReport(catalogue: Catalogue): QualityReport {
  const pkgs = catalogue.packages;
  const mps = catalogue.medicinalProducts;
  const withGtin = pkgs.filter((p) => p.gtin).length;
  const withAuth = pkgs.filter((p) => p.identifiers.length > 0).length;
  const withIng = mps.filter((p) => p.ingredients.length > 0).length;
  const withForm = mps.filter((p) => p.doseForm).length;
  // ATC lives on ProductGroups (CH) or on product identifiers (PL); count
  // products covered either way so group-less catalogs are not reported as 0%.
  const groupsWithAtc = new Set(catalogue.productGroups.filter((g) => g.atc).map((g) => g.id));
  const withAtc = mps.filter(
    (p) =>
      p.identifiers.some((i) => i.system === WHO_ATC_SYSTEM) ||
      (p.productGroupId !== undefined && groupsWithAtc.has(p.productGroupId)),
  ).length;
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
    percentProductsWithAtc: pct(withAtc, mps.length),
    percentPackagesWithMarketingStatus: pct(withMkt, pkgs.length),
    unknownFields: unknown,
    mappingCoverage: catalogue.mappingCoverage,
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
  return out;
}

/** Absolute per-recipe floors; anomalies only catch regressions against a baseline. */
export function qualityGateViolations(quality: QualityReport, gates?: QualityGates): string[] {
  if (!gates) return [];
  const out: string[] = [];
  if (
    gates.minPercentPackagesWithGtin !== undefined &&
    quality.percentPackagesWithGtin < gates.minPercentPackagesWithGtin
  ) {
    out.push(
      `percentPackagesWithGtin ${quality.percentPackagesWithGtin}% is below the ${gates.minPercentPackagesWithGtin}% floor`,
    );
  }
  return out;
}

/** Load the previous release's quality report for baseline comparisons. */
export function readPreviousQualityReport(previousDir?: string): QualityReport | undefined {
  if (!previousDir) return undefined;
  for (const candidate of [path.join(previousDir, "release", "quality-report.json"), path.join(previousDir, "quality-report.json")]) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, "utf8")) as QualityReport;
    }
  }
  return undefined;
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
