import type { Catalogue, MappingCoverageReport, SourceSnapshot } from "../canonical/types.js";

export interface AdapterContext {
  cacheDir: string;
  inputPath?: string;
  secrets: Record<string, string | undefined>;
  releaseMonth: string; // YYYY.MM data month
  cutoffDate: string; // expected sourceEffectiveDate YYYY-MM-DD
  archiveMonth: string; // YYYYMM for Swissmedic archive filename
}

export interface AdapterMetadata {
  sourceId: string;
  identityAuthority: string;
  jurisdiction: string;
  credentialsRequired: boolean;
  commercialUse: "allowed" | "disallowed" | "review-required";
  redistribution: "allowed" | "disallowed" | "review-required";
  attributionRequired: boolean;
  updateFrequency: string;
  termsUrl: string;
}

export interface FetchResult {
  files: string[];
  snapshot: SourceSnapshot;
  rawArchivePath?: string;
}

export interface Adapter {
  metadata(): AdapterMetadata;
  fetch(ctx: AdapterContext): Promise<FetchResult>;
  validateSource(ctx: AdapterContext, fetched: FetchResult): Promise<void>;
  parse(ctx: AdapterContext, fetched: FetchResult): Promise<unknown>;
  normalize(ctx: AdapterContext, parsed: unknown, snapshot: SourceSnapshot): Promise<PartialCatalogue>;
  qualityReport(catalogue: Catalogue, snapshot: SourceSnapshot): MappingCoverageReport;
}

export type PartialCatalogue = Pick<
  Catalogue,
  | "productGroups"
  | "medicinalProducts"
  | "packages"
  | "organizations"
  | "authorizations"
  | "substances"
  | "reimbursements"
  | "mappingCoverage"
> & {
  sourceSnapshots: SourceSnapshot[];
};
