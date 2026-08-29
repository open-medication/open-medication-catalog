export type {
  Authorization,
  Catalogue,
  CodedValue,
  DeclarationRow,
  EntityId,
  FieldProvenance,
  Identifier,
  Ingredient,
  MappingClass,
  MappingCoverageReport,
  MedicinalProduct,
  Organization,
  Package,
  PackageQuantity,
  ProductGroup,
  Reimbursement,
  SourceRecordRef,
  SourceSnapshot,
  Strength,
  Substance,
} from "./generated.js";

export const CANONICAL_SCHEMA_VERSION = "0.1.0" as const;

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
