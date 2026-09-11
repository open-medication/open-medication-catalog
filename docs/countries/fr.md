# France (FR)

## Sources

| Source | Role | Artifact |
| --- | --- | --- |
| BDPM (`CIS_bdpm.txt`, `CIS_CIP_bdpm.txt`, `CIS_COMPO_bdpm.txt`) | Regulatory ground truth, packs, composition, list prices and reimbursement rates | `fr-base` |

HAS SMR/ASMR avis, generic groups (`CIS_GENER`), and prescription/dispensing conditions are not mapped in v1.

## Identity

| Canonical | BDPM | R4 | R5 |
| --- | --- | --- | --- |
| MedicinalProduct | CIS | Medication extension `medicinal-product-id` | MedicinalProductDefinition |
| Package | CIP13 (CIP7 if CIP13 is missing) | Medication (one per package) | PackagedProductDefinition |
| Authorization | CIS AMM status | — | one RegulatedAuthorization per CIS |
| Organization | AMM titulaire (trimmed name) | Organization | Organization |

IDs use the same formula as Switzerland: `UUIDv5(projectNamespace, FR|bdpm|{entityType}|{authorityKey})`. Swiss IDs are unchanged.

CIP13 is emitted as `https://www.gs1.org/gtin` when it is 13 digits.

There is no `ProductGroup`. BDPM has no Präparat-style grouping in the v1 files.

## Reimbursement

CIP `taux de remboursement` is split on `;` into `Reimbursement.rates`. Indication text (HTML stripped) is stored on each rate and on `limitations`. List price is `price` in EUR. BAG `costShare` is unused.

## Reproducibility

`fr-base` attaches a zip of the downloaded BDPM txt files. BDPM overwrites files in place (no monthly archive URL). Releases are still tagged `fr-base-YYYY.MM`; `omc next-month fr-base` ships the current month if that tag does not already exist.
