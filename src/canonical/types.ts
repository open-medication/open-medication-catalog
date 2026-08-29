import type { EntityId } from "../branded.js";

export const CANONICAL_SCHEMA_VERSION = "0.1.0";

export type MappingClass =
  | "mapped"
  | "intentionally-ignored"
  | "retained-as-metadata"
  | "unknown";

export interface CodedValue {
  system: string;
  code: string;
  display?: string;
}

export interface FieldProvenance {
  sourceId: string;
  snapshotId: string;
  originalField?: string;
}

export interface Identifier {
  system: string;
  value: string;
  use?: "official" | "usual" | "secondary";
}

export interface SourceSnapshot {
  id: string;
  sourceId: string;
  identityAuthority: string;
  retrievedAt: string;
  sourceEffectiveDate?: string;
  sha256: string;
  uri: string;
  termsReviewedAt?: string;
  termsChecksum?: string;
}

export interface SourceRecordRef {
  sourceId: string;
  snapshotId: string;
  recordKey: string;
  checksum?: string;
}

export interface Organization {
  id: EntityId;
  jurisdiction: string;
  identityAuthority: string;
  authorityKey: string;
  name: string;
  role: "marketing-authorisation-holder" | "manufacturer" | "supplier";
  identifiers: Identifier[];
  sourceRecords: SourceRecordRef[];
}

export interface ProductGroup {
  id: EntityId;
  jurisdiction: string;
  identityAuthority: string;
  authorityKey: string;
  names: { text: string; language?: string }[];
  atc?: CodedValue;
  regulatoryStatus: CodedValue;
  authorizationHolderId?: EntityId;
  validityStart?: string;
  validityEnd?: string;
  identifiers: Identifier[];
  sourceRecords: SourceRecordRef[];
  metadata?: Record<string, string>;
}

export interface DeclarationRow {
  id: EntityId;
  componentNumber: string;
  componentName?: string;
  rowNumber: string;
  sortOrder?: string;
  rowType: string;
  substanceId?: EntityId;
  sourceSubstanceId?: string;
  substanceName?: string;
  roleCode?: CodedValue;
  quantity?: string;
  quantityUnit?: CodedValue;
  declarationFormat?: string;
  sourceText: string;
}

export interface Strength {
  numeratorValue?: string;
  numeratorUnit?: CodedValue;
  denominatorValue?: string;
  denominatorUnit?: CodedValue;
  text?: string;
  structured: boolean;
}

export interface Ingredient {
  id: EntityId;
  declarationRowId: EntityId;
  name: string;
  role: CodedValue;
  strength: Strength;
}

export interface MedicinalProduct {
  id: EntityId;
  jurisdiction: string;
  identityAuthority: string;
  authorityKey: string;
  productGroupId?: EntityId;
  names: { text: string; language?: string }[];
  doseForm?: CodedValue;
  routes: CodedValue[];
  regulatoryStatus: CodedValue;
  authorizationId?: EntityId;
  identifiers: Identifier[];
  declarationRows: DeclarationRow[];
  ingredients: Ingredient[];
  sourceRecords: SourceRecordRef[];
  metadata?: Record<string, string>;
}

export interface PackageQuantity {
  value?: string;
  unit?: CodedValue;
  structured: boolean;
}

export interface Package {
  id: EntityId;
  jurisdiction: string;
  identityAuthority: string;
  authorityKey: string;
  medicinalProductId: EntityId;
  productGroupId?: EntityId;
  description: string;
  quantity: PackageQuantity;
  packageType?: CodedValue;
  regulatoryStatus: CodedValue;
  marketingStatus?: CodedValue;
  reimbursementStatus?: CodedValue;
  gtin?: string;
  identifiers: Identifier[];
  fieldProvenance: Record<string, FieldProvenance>;
  sourceRecords: SourceRecordRef[];
  metadata?: Record<string, string>;
}

export interface Authorization {
  id: EntityId;
  jurisdiction: string;
  identityAuthority: string;
  authorityKey: string;
  holderId?: EntityId;
  status: CodedValue;
  medicinalProductIds: EntityId[];
  identifiers: Identifier[];
  sourceRecords: SourceRecordRef[];
}

export interface Substance {
  id: EntityId;
  identityAuthority: string;
  authorityKey: string;
  name: string;
  identifiers: Identifier[];
}

export interface Reimbursement {
  packageId: EntityId;
  status: CodedValue;
  price?: { value: string; currency: string };
  limitations?: string;
  validFrom?: string;
  validTo?: string;
  fieldProvenance: FieldProvenance;
}

export interface Catalogue {
  schemaVersion: typeof CANONICAL_SCHEMA_VERSION;
  artifactId: string;
  release?: string;
  jurisdiction: string;
  generatorVersion: string;
  productGroups: ProductGroup[];
  medicinalProducts: MedicinalProduct[];
  packages: Package[];
  organizations: Organization[];
  authorizations: Authorization[];
  substances: Substance[];
  reimbursements: Reimbursement[];
  sourceSnapshots: SourceSnapshot[];
  mappingCoverage: MappingCoverageReport[];
}

export interface MappingCoverageReport {
  sourceId: string;
  fields: { name: string; classification: MappingClass; count: number }[];
  unknownFields: string[];
}

export const SWISSMEDIC_SYSTEMS = {
  authorisation: "https://fhir.openmedicationcatalog.org/sid/ch/swissmedic/authorisation",
  sequence: "https://fhir.openmedicationcatalog.org/sid/ch/swissmedic/sequence",
  package: "https://fhir.openmedicationcatalog.org/sid/ch/swissmedic/package",
  organization: "https://fhir.openmedicationcatalog.org/sid/ch/swissmedic/organization",
  substance: "https://fhir.openmedicationcatalog.org/sid/ch/swissmedic/substance",
  doseForm: "https://fhir.openmedicationcatalog.org/CodeSystem/ch-swissmedic-dose-form",
  regulatoryStatus: "https://fhir.openmedicationcatalog.org/CodeSystem/ch-swissmedic-regulatory-status",
  packageUnit: "https://fhir.openmedicationcatalog.org/CodeSystem/ch-swissmedic-package-unit",
  route: "https://fhir.openmedicationcatalog.org/CodeSystem/ch-swissmedic-route",
  ingredientRole: "https://fhir.openmedicationcatalog.org/CodeSystem/ch-swissmedic-ingredient-role",
} as const;

export const OMC_SYSTEMS = {
  resourceId: "https://fhir.openmedicationcatalog.org/sid/resource-id",
  gtin: "https://www.gs1.org/gtin",
  jurisdiction: "urn:iso:std:iso:3166",
} as const;
