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

Published as Swissmedic `ROUTE_ADMIN` coding + label. Swissmedic records these “in accordance with the EDQM list”; the OGD codes themselves are Swissmedic mnemonics (`ORA`, `IV`, …), not EDQM `200xxxxx` identifiers.

R5 `MedicinalProductDefinition.route` therefore keeps the Swissmedic coding and, when the English UDC label equals an EDQM ROA term (HL7 IPS expansion, 5 February 2025), adds a second coding with `system` `http://standardterms.edqm.eu`. That mapping is in `adapters/ch/swissmedic/route-edqm.yaml` (48 of 71 UDC codes on the 2026.08 dump). Unmatched labels, mostly veterinary, stay Swissmedic-only.

We do not redistribute the EDQM Standard Terms database. The extra coding is an identifier assertion; displays stay the Swissmedic labels. EDQM Standard Terms remain copyright EDQM / Council of Europe ([conditions](https://www.edqm.eu/en/standard-terms-database)).

## Reproducibility

`ch-base` attaches the exact `OGD_YYYYMM.zip`. Release zips are binary-reproducible (fixed timestamps/order/compression). Raw Refdata ZIP is **not** redistributed.
