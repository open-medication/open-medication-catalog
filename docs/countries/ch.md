# Switzerland (CH)

## Sources

| Source | Role | Artifact |
| --- | --- | --- |
| Swissmedic OGD | Regulatory ground truth | `ch-base`, `ch-enriched` |
| Refdata Article Refdatabase | GTIN, trade status | `ch-enriched` only |
| BAG Spezialitätenliste | Reimbursement | adapter present, not in recipe until terms are cleared |

## Identity

| Canonical | Swissmedic | R4 | R5 |
| --- | --- | --- | --- |
| ProductGroup | Präparat `ZULASSUNGSNUMMER` | none | none (shared authorisation identifier) |
| MedicinalProduct | Sequenz auth+sequence | Medication extension `medicinal-product-id` | MedicinalProductDefinition |
| Package | Packung auth+sequence+pack code | Medication (one per package) | PackagedProductDefinition `packageFor` 1..1 |
| Authorization | authorisation number | — | one RegulatedAuthorization, `subject` = all sequence MPDs |
| Declaration row | auth+seq+component+ZEILENNUMMER+substance GUID | ingredient text | Ingredient |

## Declarations

All row types are kept (including future `G` galenic/basis rows). Structured strength is emitted only when a `per N unit` basis can be parsed without guessing. `500 mg` is never kept while discarding `per 5 ml`.

## Status

Regulatory, marketing, reimbursement, and catalogue lifecycle are separate. R4 `Medication.status` is only catalogue usability (`active` / `inactive` / omitted). Not marketed ≠ inactive.

## Refdata join

Join is authorisation number + pack code (strings). Invariant: within Swissmedic OGD, `(authorisationNumber, packageCode)` must not map to more than one sequence. Proven on the 2026-08 snapshot (0 collisions). Re-checked every `ch-base` build.

## Routes

Published as Swissmedic `ROUTE_ADMIN` coding + label. EDQM system is not asserted until codes and licence are verified.

## Reproducibility

`ch-base` attaches the exact `OGD_YYYYMM.ZIP`. Release zips are binary-reproducible (fixed timestamps/order/compression). Raw Refdata ZIP is **not** redistributed.
