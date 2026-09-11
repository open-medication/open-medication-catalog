Profile: OpenMedicationPackage
Parent: Medication
Id: OpenMedicationPackage
Title: "Open Medication Package (R4)"
Description: """One Medication per canonical Package (Swissmedic Packung).

code.text is the Refdata pack trade name when present (default language de, else first available).
If there is no Refdata name, code.text is {SEQUENZNAME} — {Swissmedic pack text} when the sequence
name is not already in the pack text, otherwise the Swissmedic pack text alone.
Other languages use the HL7 translation extension on code.text (_text).
Always keep the original identity-authority pack text in the package-description extension.

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
    OmcReimbursement named reimbursement 0..* and
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

Extension: OmcReimbursement
Id: reimbursement
Title: "OMC reimbursement detail"
Description: "Package reimbursement fields (BAG SL and BDPM CIP rates). BAG is used on experimental --enable-bag builds; not in official ch-enriched until redistribution terms are recorded."
* ^url = "https://fhir.openmedicationcatalog.org/StructureDefinition/reimbursement"
* ^context[+].type = #element
* ^context[=].expression = "Medication"
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
