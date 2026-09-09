# Open Medication Catalogue

Open-source generator that turns authoritative national medicinal-product datasets into reproducible, validated SQLite and FHIR releases.

**Software licence:** Apache-2.0 (this repository). **Generated datasets are not Apache-2.0**; each release carries upstream terms in `manifest.json` and `licensing/`.

Canonical FHIR base (immutable once published): `https://fhir.openmedicationcatalog.org`  
Public IG/package publication is gated until `https://fhir.openmedicationcatalog.org` resolves over HTTPS.

GitHub: [open-medication/open-medication-catalog](https://github.com/open-medication/open-medication-catalog)

Latest-artifact index (not GitHub `/releases/latest`):
[`https://openmedicationcatalog.org/catalog.json`](https://openmedicationcatalog.org/catalog.json)
(GitHub Pages alias: `https://open-medication.github.io/open-medication-catalog/catalog.json`)

Landing page: [`https://openmedicationcatalog.org`](https://openmedicationcatalog.org) (`site/` Astro project, published with `catalog.json` on GitHub Pages).

## Country tracker

| Jurisdiction | Sources | Adapter status | Public redistribution | Credentials |
| --- | --- | --- | --- | --- |
| CH | Swissmedic | production (this repo) | allowed (`terms_open`) | no |
| CH | Refdata | optional enrichment (`ch-enriched`) | derived fields, not the raw ZIP | yes |
| CH | BAG SL | implemented, **not** in `ch-enriched` yet | review-required | no |
| FR | BDPM | planned | French Open Licence | no |
| GB | dm+d | planned | review-required (TRUD) | yes |
| NO | FEST | planned | NLOD | no |
| CA | DPD | planned | OGL-Canada | no |
| US | FDA NDC | planned | CC0 / public domain | no |
| SA | SFDA | planned | review-required | TBD |

A **global** database will be the union of national catalogues (`requiredArtifacts` on a future recipe), not a cross-country ontology.

## Official artifacts

Composition is declared in [`artifacts.yaml`](artifacts.yaml):

```text
omc build ch-base          # Swissmedic only
omc build ch-enriched      # Swissmedic + Refdata (all-or-nothing)
```

`--source` is for **local/experimental** builds and cannot be published as `ch-base` / `ch-enriched`.

```text
pnpm install
pnpm omc build ch-base --input fixtures/ch/swissmedic/OGD_FIXTURE.zip --month 2026.08
pnpm omc search output/ch-base/release/database/medication.sqlite Metformin
```

Live Swissmedic (no credentials), archive-first:

```text
pnpm omc next-month ch-base
pnpm omc build ch-base --month 2026.08
```

`next-month` compares GitHub Releases to the Swissmedic archive and prints the newest unpublished `YYYY.MM`. If nothing newer exists it prints `up-to-date`. If a given `OGD_YYYYMM.zip` is not published yet, `omc build` exits successfully as **not yet available**.

The release workflow runs on the 1st and 15th UTC. It ships that newest unpublished month, or skips when already current. Manual dispatch can still force a month.

## Architecture

```text
ProductGroup?            ← Swissmedic Präparat (optional)
    └── MedicinalProduct ← Swissmedic Sequenz  → FHIR R5 MedicinalProductDefinition
            └── Package  ← Swissmedic Packung  → FHIR R5 PackagedProductDefinition
                                              → FHIR R4 Medication
```

IDs are UUIDv5 over `jurisdiction|identityAuthority|entityType|authorityKey`. Identifiers are strings always (`001` stays `"001"`).

## Requirements

- Node.js 22+
- pnpm 10
- Java 17+ only if you run the HL7 `validator_cli.jar`
- `xmllint` recommended for XSD validation

## Post-MVP

Signed build provenance / GitHub artifact attestations before recommending unattended hospital consumption.
