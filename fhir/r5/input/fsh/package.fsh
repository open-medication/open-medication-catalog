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
Original pack text is description (identity authority).
name is the Refdata pack trade name when present (default language de);
otherwise the Swissmedic description. Other languages use the HL7
translation extension on name (_name). Do not copy pack names onto MedicinalProductDefinition.
containedItemQuantity only when straightforward.
marketingStatus.dateRange carries trade validity dates when present.
BAG SL fields (local --enable-bag only) are on the reimbursement extension, not Swissmedic RegulatedAuthorization.
Do not fabricate nested packaging."""
* identifier 1..*
* description 1..1
* packageFor 1..1
* extension contains
    OmcJurisdictionR5 named jurisdiction 1..1 and
    OmcIdentityAuthorityR5 named identityAuthority 1..1 and
    OmcReleaseR5 named omcRelease 1..1 and
    OmcReimbursementR5 named reimbursement 0..*

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

Extension: OmcReimbursementR5
Id: reimbursement
Title: "OMC reimbursement detail"
Description: "Package reimbursement fields (BAG SL and BDPM CIP rates) on PackagedProductDefinition. BAG is used on experimental --enable-bag builds; not in official ch-enriched until redistribution terms are recorded."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/reimbursement"
* ^context[+].type = #element
* ^context[=].expression = "PackagedProductDefinition"
* extension contains
    status 1..1 and
    validFrom 0..1 and
    validTo 0..1 and
    firstListingDate 0..1 and
    expiryDate 0..1 and
    costShare 0..1 and
    dossierNumber 0..1 and
    limitations 0..1 and
    gamme 0..1 and
    price 0..* and
    rate 0..*
* extension[status].value[x] only Coding
* extension[validFrom].value[x] only date
* extension[validTo].value[x] only date
* extension[firstListingDate].value[x] only date
* extension[expiryDate].value[x] only date
* extension[costShare].value[x] only integer
* extension[dossierNumber].value[x] only string
* extension[limitations].value[x] only string
* extension[gamme].value[x] only Coding
* extension[price].extension contains
    value 1..1 and
    currency 1..1 and
    type 0..1 and
    changeType 0..1 and
    changeDate 0..1
* extension[price].extension[value].value[x] only string
* extension[price].extension[currency].value[x] only string
* extension[price].extension[type].value[x] only Coding
* extension[price].extension[changeType].value[x] only Coding
* extension[price].extension[changeDate].value[x] only date
* extension[rate].extension contains
    rate 1..1 and
    indications 0..1
* extension[rate].extension[rate].value[x] only string
* extension[rate].extension[indications].value[x] only string
