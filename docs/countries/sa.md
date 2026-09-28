# Saudi Arabia (SA)

## Sources

| Source | Role | Artifact |
| --- | --- | --- |
| SFDA registered human medicines list, the CHI-hosted `Human Drug List` workbook | One row per register number: product, package, holder, manufacturers, agents | none (local `--source sfda` only) |

The copy this adapter reads is the file on the [CHI Drug Formulary](https://www.chi.gov.sa/en/Rules/Pages/DamanDrugFormulary.aspx) page (Medication Files, “SFDA Human Drug List”). CHI’s [terms of use](https://www.chi.gov.sa/en/Help/Pages/TermsOfUse.aspx) allow only personal, non-profit use and forbid a public or commercial derived work without prior written consent. `commercialUse` and `redistribution` stay `review-required` while that consent is open. There is no `sa-base` recipe and no release-workflow entry.

The CHI privacy policy and the Policies tab are not dataset licences. The CHI open-data page does not list this workbook. A data-sharing request is not a grant. If a later build takes the same list from sfda.gov.sa, review that host on its own. Do not carry this `review-required` reading, or a CHI consent, across to an SFDA download.

The CHI Drug Formulary workbook and the CHI Active Ingredient workbook on the same page are out of scope. The herbal list is out of scope. `fetch` requires `--input`. The adapter does not download the live list.

## Identity

| Canonical | SFDA workbook | R4 | R5 |
| --- | --- | --- | --- |
| MedicinalProduct | `RegisterNumber` | Medication extension `medicinal-product-id` | MedicinalProductDefinition |
| Package | same register number (1:1 with the row) | Medication (one per package) | PackagedProductDefinition |
| Authorization | `RegisterNumber`; holder is the marketing company | — | one RegulatedAuthorization per register number |
| Organization | `role\|trimmed name` | Organization | Organization |
| Active substance | trimmed scientific-name token | Medication.ingredient | Ingredient |

IDs use the same formula as Switzerland: `UUIDv5(projectNamespace, SA|sfda|{entityType}|{authorityKey})`.

There is no `ProductGroup`. One drugs-list row is one registered presentation. This workbook has one row per register number, so the package authority key is that number. The entity type keeps the UUID distinct. If a later file repeats a register number, the package key becomes `registerNumber|packageType|packageSize`.

`Marketing Company` is `marketing-authorisation-holder`. `Manufacture Name` and `2nd Manufacture Name` are `manufacturer`. `Main Agent`, `Secosnd Agent` (the header spelling), and `Third Agent` are `supplier`. An agent is not promoted to holder. `Marketing DENR CompanyId` stays product metadata.

Domain is FHIR `http://hl7.org/fhir/medicinal-product-domain` `Human`. A blank `Product type` is kept. A non-empty product type other than `Human` is dropped. `DrugType` `Health` stays metadata.

Dose form, route, package type, size unit, strength unit, authorization status, and marketing status stay SFDA source text (English system URLs and `code` values). An Arabic coded token with no English map is a quality failure. Arabic text stays in `display` or in metadata. This workbook’s coded columns are Latin. `originalField` keeps the real header.

`AtcCode1` and `AtcCode2` are identifiers on `http://www.whocc.no/atc` only when the whole cell is a WHO ATC code. `NA`, prose labels, and `Q`-prefixed ATCvet codes stay metadata. No EDQM crosswalk.

Public price stays package metadata, currency SAR. It is not a `Reimbursement`. Pricing dates stay text (Hijri, Gregorian, or an Excel serial). Legal status (`Prescription` / `OTC`) stays metadata. Authorization status is product `regulatoryStatus` and authorization `status`. Marketing status is package `marketingStatus`. The source token is kept (`Valid`, `Withdrawn by MAH`, `Invalid`, `Withdrawn by regulatory authority`, `Suspended`, `Conditional Approval`; `Marketed` / `Not Marketed`). Those are not folded into `inactive`.

Scientific name, strength, and strength unit are parallel comma-separated lists. Commas inside parentheses stay in the token. Equal lengths, or one unit shared by every strength, and a parseable number become structured strength. A range, a thousands comma (`1,000,000` IU), or one number shared by several names stays source text. A comma that still breaks the split leaves the whole scientific name as source text.

`PackageSize` is the pack count. `PackageTypes` is `packageType`. `Size` and `SizeUnit` are the fill (`SizeUnit` `--` is blank). A GTIN of 13 or 14 digits is `https://www.gs1.org/gtin`. Shelf life, storage conditions (English and Arabic), distribute area, product control, description code, register year, certificate date, marketing country, manufacture country, and the numeric `2nd Manufacture Country` id stay metadata.

## Reimbursement

None. This workbook is not a payer file.

## Reproducibility

Local only:

```text
pnpm omc build SA --source sfda --input <file> --month 2026.04
```

The committed fixture under `fixtures/sa/sfda/` is synthetic rows in this column shape. The repo does not vendor the CHI workbook. Custom `--source` builds cannot be `--publish`ed.

## Consent request

Publish waits on written consent. Send it to `Portal@CHI.gov.sa` and `dmo@chi.gov.sa`.
