# France (FR)

## Sources

| Source | Role | Artifact |
| --- | --- | --- |
| BDPM (`CIS_bdpm.txt`, `CIS_CIP_bdpm.txt`, `CIS_COMPO_bdpm.txt`) | Regulatory ground truth, packs, composition, list prices and reimbursement rates | `fr-base`, `fr-enriched` |
| Open Medic (Assurance Maladie, ameli open data) | ATC enrichment (per CIP13) | `fr-enriched` |

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

## ATC

**ANSM removed `CIS_ATC_bdpm.txt` from the public BDM when it moved to the v4 file set.** The URL still answers `200` with a 0-byte body, but the file is absent from the download page and from the official *Contenu et format des fichiers téléchargeables* (v4) PDF, so `fr-base` (which stays BDPM-only) carries no ATC — ANSM still displays the code per product on the BDPM fiche, but publishes no bulk form.

`fr-enriched` adds ATC from [Open Medic](https://www.data.gouv.fr/datasets/open-medic-base-complete-sur-les-depenses-de-medicaments-interregimes) (Assurance Maladie, Licence Ouverte 2.0):

- Open Medic keys ATC per CIP13 presentation; OMC joins CIP13 → package, and attaches the code to the **product** (as a `http://www.whocc.no/atc` identifier) only when every matched presentation of that product agrees. Disagreements are counted, never guessed.
- **Coverage is partial by construction**: Open Medic lists medicines delivered and reimbursed in city care. Measured on the 2025 edition against fr-base 2026.09: 61% of products (8,953 of 14,600) and 58% of packages. The largest ATC-less group is marketed-but-non-reimbursed products. The `fr-enriched` quality gate floors ATC at 50% so a zero-match join fails the build; partial coverage is expected and documented here.
- Editions are annual and lag the calendar year (the 2025 edition shipped mid-2026). Builds probe edition `release year − 1`, then `release year − 2`, and record the edition in the source snapshot.
- The raw Open Medic ZIP (spending data, ~27 MB) is not redistributed; only the derived ATC field is.

## Reimbursement

CIP `taux de remboursement` is split on `;` into `Reimbursement.rates`. Indication text (HTML stripped) is stored on each rate and on `limitations`. List price is `price` in EUR. BAG `costShare` is unused.

## Reproducibility

`fr-base` attaches a zip of the downloaded BDPM txt files. BDPM overwrites files in place (no monthly archive URL). Releases are still tagged `fr-base-YYYY.MM`; `omc next-month fr-base` ships the current month if that tag does not already exist.
