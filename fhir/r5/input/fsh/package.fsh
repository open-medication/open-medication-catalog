Profile: OpenMedicinalProductDefinition
Parent: MedicinalProductDefinition
Id: OpenMedicinalProductDefinition
Title: "Open Medicinal Product Definition (R5)"
Description: "Canonical MedicinalProduct (Swissmedic Sequenz) → MedicinalProductDefinition. ProductGroup/Präparat is not projected as a resource."
* identifier 1..*
* name 1..*
* extension contains
    OmcJurisdictionR5 named jurisdiction 1..1 and
    OmcIdentityAuthorityR5 named identityAuthority 1..1 and
    OmcReleaseR5 named omcRelease 1..1 and
    OmcProductGroupIdR5 named productGroupId 0..1

Profile: OpenPackagedProductDefinition
Parent: PackagedProductDefinition
Id: OpenPackagedProductDefinition
Title: "Open Packaged Product Definition (R5)"
Description: """Canonical Package → PackagedProductDefinition.
packageFor is 1..1 for Swissmedic packs (one sequence per pack).
Original pack text is description. containedItemQuantity only when straightforward.
Do not fabricate nested packaging."""
* identifier 1..*
* description 1..1
* packageFor 1..1
* extension contains
    OmcJurisdictionR5 named jurisdiction 1..1 and
    OmcIdentityAuthorityR5 named identityAuthority 1..1 and
    OmcReleaseR5 named omcRelease 1..1

Profile: OpenRegulatedAuthorization
Parent: RegulatedAuthorization
Id: OpenRegulatedAuthorization
Title: "Open Regulated Authorization (R5)"
Description: "One RegulatedAuthorization per Swissmedic authorisation. subject lists every sequence MedicinalProductDefinition."
* identifier 1..*
* subject 1..*
* extension contains
    OmcJurisdictionR5 named jurisdiction 1..1 and
    OmcIdentityAuthorityR5 named identityAuthority 1..1 and
    OmcReleaseR5 named omcRelease 1..1

Extension: OmcJurisdictionR5
Id: jurisdiction
Title: "Jurisdiction"
Description: "ISO country code of the catalogue record (e.g. CH)."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/jurisdiction"
* ^context[+].type = #element
* ^context[=].expression = "MedicinalProductDefinition"
* ^context[+].type = #element
* ^context[=].expression = "PackagedProductDefinition"
* ^context[+].type = #element
* ^context[=].expression = "RegulatedAuthorization"
* ^context[+].type = #element
* ^context[=].expression = "Ingredient"
* ^context[+].type = #element
* ^context[=].expression = "Organization"
* value[x] only string
* valueString 1..1

Extension: OmcIdentityAuthorityR5
Id: identity-authority
Title: "Identity authority"
Description: "Issuing authority for the business identifier (e.g. swissmedic), not the acquisition feed."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/identity-authority"
* ^context[+].type = #element
* ^context[=].expression = "MedicinalProductDefinition"
* ^context[+].type = #element
* ^context[=].expression = "PackagedProductDefinition"
* ^context[+].type = #element
* ^context[=].expression = "RegulatedAuthorization"
* ^context[+].type = #element
* ^context[=].expression = "Ingredient"
* ^context[+].type = #element
* ^context[=].expression = "Organization"
* value[x] only string
* valueString 1..1

Extension: OmcReleaseR5
Id: omc-release
Title: "OMC release"
Description: "OMC artifact id and data month (e.g. ch-base-2026.08)."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/omc-release"
* ^context[+].type = #element
* ^context[=].expression = "MedicinalProductDefinition"
* ^context[+].type = #element
* ^context[=].expression = "PackagedProductDefinition"
* ^context[+].type = #element
* ^context[=].expression = "RegulatedAuthorization"
* ^context[+].type = #element
* ^context[=].expression = "Ingredient"
* ^context[+].type = #element
* ^context[=].expression = "Organization"
* value[x] only string
* valueString 1..1

Extension: OmcProductGroupIdR5
Id: product-group-id
Title: "Canonical ProductGroup id"
Description: "UUIDv5 of the optional ProductGroup (Swissmedic Präparat)."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/product-group-id"
* ^context[+].type = #element
* ^context[=].expression = "MedicinalProductDefinition"
* value[x] only string
* valueString 1..1
