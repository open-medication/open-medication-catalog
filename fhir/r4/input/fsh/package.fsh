Profile: OpenMedicationPackage
Parent: Medication
Id: OpenMedicationPackage
Title: "Open Medication Package (R4)"
Description: """One Medication per canonical Package (Swissmedic Packung).

Always keep the original pack text in code.text (and the package-description extension).
Medication.amount is populated only for a faithful structured ratio.

Medication.status is catalogue-record usability only:
* Z, B, S, N, A → active
* D, BA, U → inactive
* unknown / unmapped → omit status rather than invent it

Do not set inactive merely because a pack is not marketed or not reimbursed."""
* identifier 1..*
* code 1..1
* code.text 1..1
* status 0..1
* amount 0..1
* extension contains
    OmcJurisdiction named jurisdiction 1..1 and
    OmcIdentityAuthority named identityAuthority 1..1 and
    OmcRelease named omcRelease 1..1 and
    OmcRegulatoryStatus named regulatoryStatus 0..1 and
    OmcMarketingStatus named marketingStatus 0..1 and
    OmcReimbursementStatus named reimbursementStatus 0..1 and
    OmcPackageDescription named packageDescription 1..1 and
    OmcMedicinalProductId named medicinalProductId 0..1 and
    OmcProductGroupId named productGroupId 0..1

Extension: OmcJurisdiction
Id: jurisdiction
Title: "Jurisdiction"
Description: "ISO country code of the catalogue record (e.g. CH)."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/jurisdiction"
* ^context[+].type = #element
* ^context[=].expression = "Medication"
* ^context[+].type = #element
* ^context[=].expression = "Organization"
* value[x] only string
* valueString 1..1

Extension: OmcIdentityAuthority
Id: identity-authority
Title: "Identity authority"
Description: "Issuing authority for the business identifier (e.g. swissmedic), not the acquisition feed."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/identity-authority"
* ^context[+].type = #element
* ^context[=].expression = "Medication"
* ^context[+].type = #element
* ^context[=].expression = "Organization"
* value[x] only string
* valueString 1..1

Extension: OmcRelease
Id: omc-release
Title: "OMC release"
Description: "OMC artifact id and data month (e.g. ch-base-2026.08)."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/omc-release"
* ^context[+].type = #element
* ^context[=].expression = "Medication"
* ^context[+].type = #element
* ^context[=].expression = "Organization"
* value[x] only string
* valueString 1..1

Extension: OmcRegulatoryStatus
Id: regulatory-status
Title: "Regulatory status"
Description: "Authority regulatory status coding; distinct from Medication.status and from marketing/reimbursement."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/regulatory-status"
* ^context[+].type = #element
* ^context[=].expression = "Medication"
* value[x] only Coding
* valueCoding 1..1

Extension: OmcMarketingStatus
Id: marketing-status
Title: "Marketing status"
Description: "Trade/marketing status from an enrichment source (e.g. Refdata). Not Medication.status."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/marketing-status"
* ^context[+].type = #element
* ^context[=].expression = "Medication"
* value[x] only Coding
* valueCoding 1..1

Extension: OmcReimbursementStatus
Id: reimbursement-status
Title: "Reimbursement status"
Description: "Reimbursement listing status (e.g. BAG). Not Medication.status."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/reimbursement-status"
* ^context[+].type = #element
* ^context[=].expression = "Medication"
* value[x] only Coding
* valueCoding 1..1

Extension: OmcPackageDescription
Id: package-description
Title: "Original package description"
Description: "Lossless original pack text from the identity authority."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/package-description"
* ^context[+].type = #element
* ^context[=].expression = "Medication"
* value[x] only string
* valueString 1..1

Extension: OmcMedicinalProductId
Id: medicinal-product-id
Title: "Canonical MedicinalProduct id"
Description: "UUIDv5 of the canonical MedicinalProduct (Swissmedic Sequenz) this package belongs to."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/medicinal-product-id"
* ^context[+].type = #element
* ^context[=].expression = "Medication"
* value[x] only string
* valueString 1..1

Extension: OmcProductGroupId
Id: product-group-id
Title: "Canonical ProductGroup id"
Description: "UUIDv5 of the optional ProductGroup (Swissmedic Präparat)."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/product-group-id"
* ^context[+].type = #element
* ^context[=].expression = "Medication"
* value[x] only string
* valueString 1..1

Instance: OmcSidResourceId
InstanceOf: NamingSystem
Usage: #definition
* name = "OmcResourceId"
* status = #draft
* kind = #identifier
* date = "2026-08-29"
* uniqueId[0].type = #uri
* uniqueId[0].value = "https://fhir.openmedicationcatalog.org/sid/resource-id"
* uniqueId[0].preferred = true
