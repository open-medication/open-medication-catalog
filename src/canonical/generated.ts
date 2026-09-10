/* eslint-disable */
/** Generated from canonical/schema/catalogue.schema.json. Do not edit. */

/**
 * UUIDv5 canonical id. Stored as a string; never coerced to a number.
 *
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "EntityId".
 */
export type EntityId = string;
/**
 * Authority business key. Identifiers are strings always (001 stays 001).
 *
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "AuthorityKey".
 */
export type AuthorityKey = string;
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "MappingClass".
 */
export type MappingClass = "mapped" | "intentionally-ignored" | "retained-as-metadata" | "unknown";

/**
 * OMC canonical catalogue 0.1.0. JSON Schema is the source of truth; TypeScript types are generated from this file.
 */
export interface Catalogue {
  schemaVersion: "0.1.0";
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
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "ProductGroup".
 */
export interface ProductGroup {
  id: EntityId;
  jurisdiction: string;
  identityAuthority: string;
  authorityKey: AuthorityKey;
  names: LocalizedName[];
  atc?: CodedValue;
  regulatoryStatus: CodedValue;
  authorizationHolderId?: EntityId;
  validityStart?: string;
  validityEnd?: string;
  identifiers: Identifier[];
  sourceRecords: SourceRecordRef[];
  metadata?: StringMap;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "LocalizedName".
 */
export interface LocalizedName {
  text: string;
  language?: string;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "CodedValue".
 */
export interface CodedValue {
  system: string;
  code: string;
  display?: string;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "Identifier".
 */
export interface Identifier {
  system: string;
  value: string;
  use?: "official" | "usual" | "secondary";
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "SourceRecordRef".
 */
export interface SourceRecordRef {
  sourceId: string;
  snapshotId: string;
  recordKey: string;
  checksum?: string;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "StringMap".
 */
export interface StringMap {
  [k: string]: string;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "MedicinalProduct".
 */
export interface MedicinalProduct {
  id: EntityId;
  jurisdiction: string;
  identityAuthority: string;
  authorityKey: AuthorityKey;
  productGroupId?: EntityId;
  names: LocalizedName[];
  doseForm?: CodedValue;
  routes: CodedValue[];
  regulatoryStatus: CodedValue;
  authorizationId?: EntityId;
  identifiers: Identifier[];
  declarationRows: DeclarationRow[];
  ingredients: Ingredient[];
  sourceRecords: SourceRecordRef[];
  metadata?: StringMap;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "DeclarationRow".
 */
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
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "Ingredient".
 */
export interface Ingredient {
  id: EntityId;
  declarationRowId: EntityId;
  name: string;
  role: CodedValue;
  strength: Strength;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "Strength".
 */
export interface Strength {
  numeratorValue?: string;
  numeratorUnit?: CodedValue;
  denominatorValue?: string;
  denominatorUnit?: CodedValue;
  text?: string;
  structured: boolean;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "Package".
 */
export interface Package {
  id: EntityId;
  jurisdiction: string;
  identityAuthority: string;
  authorityKey: AuthorityKey;
  medicinalProductId: EntityId;
  productGroupId?: EntityId;
  description: string;
  quantity: PackageQuantity;
  packageType?: CodedValue;
  regulatoryStatus: CodedValue;
  marketingStatus?: CodedValue;
  reimbursementStatus?: CodedValue;
  gtin?: string;
  names?: LocalizedName[];
  marketingValidFrom?: string;
  marketingValidTo?: string;
  identifiers: Identifier[];
  fieldProvenance: FieldProvenanceMap;
  sourceRecords: SourceRecordRef[];
  metadata?: StringMap;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "PackageQuantity".
 */
export interface PackageQuantity {
  value?: string;
  unit?: CodedValue;
  structured: boolean;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "FieldProvenanceMap".
 */
export interface FieldProvenanceMap {
  [k: string]: FieldProvenance;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "FieldProvenance".
 */
export interface FieldProvenance {
  sourceId: string;
  snapshotId: string;
  originalField?: string;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "Organization".
 */
export interface Organization {
  id: EntityId;
  jurisdiction: string;
  identityAuthority: string;
  authorityKey: AuthorityKey;
  name: string;
  role: "marketing-authorisation-holder" | "manufacturer" | "supplier";
  identifiers: Identifier[];
  sourceRecords: SourceRecordRef[];
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "Authorization".
 */
export interface Authorization {
  id: EntityId;
  jurisdiction: string;
  identityAuthority: string;
  authorityKey: AuthorityKey;
  holderId?: EntityId;
  status: CodedValue;
  medicinalProductIds: EntityId[];
  identifiers: Identifier[];
  sourceRecords: SourceRecordRef[];
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "Substance".
 */
export interface Substance {
  id: EntityId;
  identityAuthority: string;
  authorityKey: AuthorityKey;
  name: string;
  identifiers: Identifier[];
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "Reimbursement".
 */
export interface Reimbursement {
  packageId: EntityId;
  status: CodedValue;
  price?: {
    value: string;
    currency: string;
  };
  prices?: ProductPrice[];
  limitations?: string;
  validFrom?: string;
  validTo?: string;
  firstListingDate?: string;
  expiryDate?: string;
  costShare?: number;
  gamme?: CodedValue;
  dossierNumber?: string;
  fieldProvenance: FieldProvenance;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "ProductPrice".
 */
export interface ProductPrice {
  value: string;
  currency: string;
  type?: CodedValue;
  changeType?: CodedValue;
  changeDate?: string;
}
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "SourceSnapshot".
 */
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
/**
 * This interface was referenced by `Catalogue`'s JSON-Schema
 * via the `definition` "MappingCoverageReport".
 */
export interface MappingCoverageReport {
  sourceId: string;
  fields: {
    name: string;
    classification: MappingClass;
    count: number;
  }[];
  unknownFields: string[];
}
