# United States (US)

## Sources

| Source | Role | Artifact |
| --- | --- | --- |
| FDA NDC Directory (`product.txt`, `package.txt` in `ndctext.zip`) | Finished marketed drugs: product listing, packages, labeler, active ingredients | `us-base` |

Unfinished drugs, compounded drugs, and the excluded-listings file are not mapped. Animal drugs are not in this directory, so there is no `us-vet-base`. DailyMed labels and RxNorm are not this source.

Inclusion in the NDC Directory does not mean FDA verified the listing, approved the product, or that a payer covers it. The labeler who submitted the SPL is responsible for the row.

## Identity

| Canonical | FDA NDC | R4 | R5 |
| --- | --- | --- | --- |
| MedicinalProduct | `ProductID` (product NDC plus SPL document id) | Medication extension `medicinal-product-id` | MedicinalProductDefinition |
| Package | `NDCPackageCode` | Medication (one per package) | PackagedProductDefinition |
| Authorization | one per `ProductID`; `ApplicationNumber` is an identifier when present | — | one RegulatedAuthorization per listing |
| Organization | labeler code (first segment of `ProductNDC`, leading zeros kept) | Organization | Organization |
| Active substance | `SubstanceName` (preferred name; this file has no UNII) | Medication.ingredient | Ingredient |

IDs use the same formula as Switzerland: `UUIDv5(projectNamespace, US|fda|{entityType}|{authorityKey})`. `ProductNDC` is an identifier, not the product key, because it is not unique across listings.

The package identifier is the hyphenated directory code. A secondary identifier is the 11-digit HIPAA form when the code is 4-4-2, 5-3-2, or 5-4-1 (pad the short segment with a leading zero to reach 5-4-2). NDC is not a GTIN. The uniform 12-digit NDC format takes effect on 7 March 2033 and is not emitted yet.

There is no `ProductGroup`. A proprietary name is not a Präparat-style group.

A repeated `NDCPackageCode` on the same listing (a newer marketing start for the same pack) keeps the later start date.

`ProductTypeName` values in the finished directory are human (prescription, OTC, vaccine, plasma derivative, allergenic, cellular therapy). A type that says animal or veterinary is dropped. Dose form and route stay FDA source text (no EDQM crosswalk).

`MarketingCategoryName` (NDA, ANDA, BLA, OTC monograph, unapproved, and the rest) is regulatory status. Marketing start and end dates are `YYYYMMDD`. The main files only list products whose marketing window is current; an end date on or before the release cutoff is `inactive`. DEA schedule, pharmacological class, product type, sample-package flag, and listing-certification date stay in metadata.

Active ingredients are the parallel `SubstanceName`, `ACTIVE_NUMERATOR_STRENGTH`, and `ACTIVE_INGRED_UNIT` lists (the definitions page calls the strength columns `StrengthNumber` and `StrengthUnit`; both headers are accepted). When the three lists have the same length and the unit is `mg/1` or `mg/5mL` style, strength is a structured ratio. Otherwise the ingredient keeps the source text.

Package quantity is structured only for a single leading count with no `/` (`100 TABLET in 1 BOTTLE`). Multilevel text (`4 BOTTLES in 1 CARTON/100 TABLETS in 1 BOTTLE`) stays unstructured.

## Reimbursement

None. The NDC Directory is not a payer file.

## Reproducibility

`us-base` attaches the downloaded `ndctext.zip`. FDA overwrites that zip in place (it is updated daily). Releases are still tagged `us-base-YYYY.MM`; `omc next-month us-base` ships the current month if that tag does not already exist.

FDA.gov content is a US government work and, unless otherwise noted, is in the public domain. Credit to the U.S. Food and Drug Administration is appreciated but not required. The terms checksum covers the `#linking` section of the FDA website policies page.
