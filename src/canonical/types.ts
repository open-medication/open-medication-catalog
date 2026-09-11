export type {
  Authorization,
  Catalogue,
  CodedValue,
  DeclarationRow,
  EntityId,
  FieldProvenance,
  Identifier,
  Ingredient,
  LocalizedName,
  MappingClass,
  MappingCoverageReport,
  MedicinalProduct,
  Organization,
  Package,
  PackageQuantity,
  ProductGroup,
  ProductPrice,
  Reimbursement,
  ReimbursementRate,
  SourceRecordRef,
  SourceSnapshot,
  Strength,
  Substance,
} from "./generated.js";

export const CANONICAL_SCHEMA_VERSION = "0.1.1" as const;

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

export const BDPM_SYSTEMS = {
  cis: "https://fhir.openmedicationcatalog.org/sid/fr/bdpm/cis",
  cip: "https://fhir.openmedicationcatalog.org/sid/fr/bdpm/cip",
  cip7: "https://fhir.openmedicationcatalog.org/sid/fr/bdpm/cip7",
  organization: "https://fhir.openmedicationcatalog.org/sid/fr/bdpm/organization",
  substance: "https://fhir.openmedicationcatalog.org/sid/fr/bdpm/substance",
  doseForm: "https://fhir.openmedicationcatalog.org/CodeSystem/fr-bdpm-dose-form",
  route: "https://fhir.openmedicationcatalog.org/CodeSystem/fr-bdpm-route",
  regulatoryStatus: "https://fhir.openmedicationcatalog.org/CodeSystem/fr-bdpm-regulatory-status",
  marketingStatus: "https://fhir.openmedicationcatalog.org/CodeSystem/fr-bdpm-marketing-status",
  ingredientRole: "https://fhir.openmedicationcatalog.org/CodeSystem/fr-bdpm-ingredient-role",
  collectivites: "https://fhir.openmedicationcatalog.org/CodeSystem/fr-bdpm-agrement-collectivites",
} as const;

export const OMC_SYSTEMS = {
  resourceId: "https://fhir.openmedicationcatalog.org/sid/resource-id",
  gtin: "https://www.gs1.org/gtin",
  jurisdiction: "urn:iso:std:iso:3166",
} as const;
