# Switzerland (CH)

## Sources

| Source | Role | Artifact |
| --- | --- | --- |
| Swissmedic OGD | Regulatory ground truth | `ch-base`, `ch-enriched` (HAM); `ch-vet-base`, `ch-vet-enriched` (TAM) |
| Refdata Article Refdatabase | GTIN, pack trade names (DE/FR), Human/Veterinary domain | `ch-enriched` and `ch-vet-enriched` |
| BAG Spezialitätenliste | Reimbursement (status, prices, limitations, cost share, gamme, dates, dossier) | adapter present; **not** in the public recipe until terms are cleared. Local: `omc build ch-enriched --enable-bag`. Not used for veterinary artifacts. |

Enrichment maps fields Swissmedic OGD does **not** already carry. Join keys, ATC, Abgabekategorie, and sequence number are not copied from Refdata. BAG IDMP product fields that duplicate Swissmedic (dose form, ingredients, ATC, German regulatory name) are skipped.

## Identity

| Canonical | Swissmedic | R4 | R5 |
| --- | --- | --- | --- |
| ProductGroup | Präparat `ZULASSUNGSNUMMER` | none | none (shared authorisation identifier) |
| MedicinalProduct | Sequenz auth+sequence | Medication extension `medicinal-product-id` | MedicinalProductDefinition |
| Package | Packung auth+sequence+pack code | Medication (one per package) | PackagedProductDefinition `packageFor` 1..1 |
| Authorization | authorisation number | — | one RegulatedAuthorization, `subject` = all sequence MPDs |
| Domain | Präparat `VERWENDUNG` (`HAM` / `TAM`) | Medication extension `domain` | `MedicinalProductDefinition.domain` |
| Declaration row | auth+seq+component+ZEILENNUMMER+substance GUID | ingredient text | Ingredient |

`HAM` maps to FHIR `Human`, `TAM` to `Veterinary` (`http://hl7.org/fhir/medicinal-product-domain`). Official recipes split by `VERWENDUNG`: `ch-base` / `ch-enriched` keep HAM only; `ch-vet-base` / `ch-vet-enriched` keep TAM. Domain is still set on every product so a merged store can tell them apart. R4 has no native slot, so the same Coding is an OMC extension on `Medication`.

## Declarations

All row types are kept (including future `G` galenic/basis rows). Structured strength is emitted only when a `per N unit` basis can be parsed without guessing. `500 mg` is never kept while discarding `per 5 ml`.

## Status

Regulatory, marketing, reimbursement, and catalogue lifecycle are separate. R4 `Medication.status` is only catalogue usability (`active` / `inactive` / omitted). Not marketed ≠ inactive.

## Refdata join

Join is authorisation number + pack code. Refdata zero-pads Swissmedic numbers inside `RegulatedAuthorisationIdentifier` (authorisation to 5 digits, pack code to 3) while Swissmedic OGD does not pad, so join keys are compared unpadded. Invariant: within Swissmedic OGD, `(authorisationNumber, packageCode)` must not map to more than one sequence. Proven on the 2026-08 snapshot (0 collisions). Re-checked every `ch-base` and `ch-vet-base` build.

Refdata names are pack-level trade names, not sequence names. They go on `Package.names` in the languages the source carries (typically `de`/`fr`). Swissmedic `description` stays the original pack text. FHIR R5 puts the default-language name on `PackagedProductDefinition.name` and other languages on the [translation](http://hl7.org/fhir/StructureDefinition/translation) extension; R4 does the same on `Medication.code.text`. They are not copied onto `MedicinalProductDefinition.name`.

`ProductClass=NONPHARMA` articles and articles without a `DataCarrierIdentifier` (e.g. blood products under the collective registration 99999) are not applied. Articles whose `Domain` differs from the package's domain (Human vs Veterinary) are skipped. ATC and `LegalStatusOfSupply` (Abgabekategorie) mismatches against Swissmedic are recorded as intentionally ignored. Official `ch-enriched` / `ch-vet-enriched` builds fail if GTIN coverage drops below the recipe floor in `artifacts.yaml`.

**Coverage is partial by construction**: Refdata is a voluntary registration database — manufacturers register their articles with GTIN. Measured on the 2026-08 snapshot: 79.7% of HAM packs (80% of active `Z` packs; revoked `D` packs are never registered) and 61.8% of TAM packs carry a GTIN after the join. The recipe floors (65% HAM / 50% TAM) exist to catch a broken join, not to police registration rates.

The Refdata 2.0 API file also carries elements OMC does not map yet (`marketingStatus`, `productPrice`, `documentReference`, `hpc`); they surface as unknown fields in every quality report so the drift stays visible.

The Refdata download is nested SIMIS XML (`Article/MedicinalProduct`, `Article/PackagedProduct`); `PackagedProduct/DataCarrierIdentifier` is the GTIN. Unknown elements are surfaced as unknown fields instead of being guessed at — the 2026.08 releases shipped 18,309 packages with zero GTINs because the parser had been written against an invented flat format that Refdata never produced.

## BAG join

Join is package GTIN (from Refdata) to CH EPL `PackagedProductDefinition.packaging.identifier` (`urn:oid:2.51.1.1`), then `RegulatedAuthorization` of type Reimbursement SL. Official `ch-enriched` does not include BAG. `OMC_ENABLE_BAG=1` or `--enable-bag` injects BAG for a **local** zip (`manifest.experimentalBag: true`) that cannot be `--publish`ed. Fetch still requires `--input` until a stable FHIR export URL is recorded. Outreach to `epl@bag.admin.ch` (Cc `Arzneimittel-Krankenversicherung@bag.admin.ch`) is in progress; licence flags stay `review-required`. OMC is not the official SL; [sl.bag.admin.ch](https://sl.bag.admin.ch/sl) remains the KVV Art. 71 publication.

## Routes

Published as Swissmedic `ROUTE_ADMIN` coding + label. Swissmedic records these “in accordance with the EDQM list”; the OGD codes themselves are Swissmedic mnemonics (`ORA`, `IV`, …), not EDQM `200xxxxx` identifiers.

R5 `MedicinalProductDefinition.route` therefore keeps the Swissmedic coding and, when the English UDC label equals an EDQM ROA term (HL7 IPS expansion, 5 February 2025), adds a second coding with `system` `http://standardterms.edqm.eu`. That mapping is in `adapters/ch/swissmedic/route-edqm.yaml` (48 of 71 UDC codes on the 2026.08 dump). Unmatched labels, mostly veterinary, stay Swissmedic-only.

We do not redistribute the EDQM Standard Terms database. The extra coding is an identifier assertion; displays stay the Swissmedic labels. EDQM Standard Terms remain copyright EDQM / Council of Europe ([conditions](https://www.edqm.eu/en/standard-terms-database)).

## Reproducibility

`ch-base` attaches the exact `OGD_YYYYMM.zip`. Release zips are binary-reproducible (fixed timestamps/order/compression). Raw Refdata ZIP is **not** redistributed.
