# Licences

The **generator** (CLI, adapters, schemas, Implementation Guide sources) is Apache-2.0.

Upstream medicinal-product data is **not** Apache-2.0. Each source keeps its own terms. We record those terms, a checksum of the terms page, and three **licence flags** so downstream users can see our reading at a glance and verify it.

## Disclaimer

The flags (`commercialUse`, `redistribution`, `attributionRequired`) are **indicators of our interpretation** of the linked upstream terms at `terms.reviewedAt`. They are not a licence grant and not legal advice. They may be misclassified.

We are not liable for misinterpreting upstream licences. We are not liable for fitness for a specific purpose, or for legal compatibility or suitability for integration into any downstream product. **You must cross-check the linked upstream terms before use.**

We do not control how those terms are worded or **when they change**. Official builds checksum the terms page and halt redistribution if the live page no longer matches the committed snapshot. That check is a snapshot, not a guarantee the live page stays still.

## Licence flags

| Flag | Values | Meaning |
| --- | --- | --- |
| `commercialUse` | `allowed` / `disallowed` / `review-required` | Whether we found a grant of commercial reuse |
| `redistribution` | `allowed` / `disallowed` / `review-required` | Whether we found a grant to redistribute derived catalog data |
| `attributionRequired` | `true` / `false` | Whether the terms require attribution |

| Value | When to use it |
| --- | --- |
| `allowed` | The linked terms contain an **explicit grant** for that activity. Record `terms.url` (and `terms.fragment` when the page defines several licences). |
| `disallowed` | The linked terms contain an **explicit prohibition**. Do not put the source in a public recipe. |
| `review-required` | Terms are missing, credential-gated, ambiguous, or not yet reviewed. **Not** in a public recipe until that is resolved. |

`attributionRequired` is `true` when the terms ask for attribution, including when reuse is otherwise unrestricted if fields are unchanged.

A source may have `redistribution: allowed` for **derived fields only** while `releasePolicy.redistributeRaw: false` (Refdata: the credential-gated ZIP is not shipped).

## Current sources

| Source | Commercial use | Redistribution | Attribution | Terms |
| --- | --- | --- | --- | --- |
| Swissmedic OGD | allowed (`terms_open`) | allowed | required | [opendata.swiss terms_open](https://opendata.swiss/en/terms-of-use#terms_open) |
| Refdata | allowed | derived fields; not the credential-gated ZIP | required if fields unchanged | [Refdata article terms](https://www.refdata.ch/de/artikel/abfrage/artikel-refdatabase-gtin) |
| BAG SL | review-required | review-required | TBD | [BAG SL data](https://sl.bag.admin.ch/resources/current-and-archived-data) |

BAG flags stay `review-required` until a written reuse grant. Outreach to `epl@bag.admin.ch` (Cc `Arzneimittel-Krankenversicherung@bag.admin.ch`) is in progress. Fetch still requires `--input`. Do not treat the download SPA or CH EPL IG CC0 as a data licence.

Flags live in `adapters/<jurisdiction>/<source>/source.yaml`. Adapter `metadata()` must read them from that file.

## How to verify

1. Open `terms.url` (on the [licence page](https://openmedicationcatalog.org/licence), on each download card, and in every release `licensing/SOURCES.md` / `manifest.json`).
2. Compare the live page to `terms.checksum` (SHA-256 of normalized HTML, or of the `#fragment` slice when set). Swissmedic hashes the `#terms_open` definition only, so CMS chrome on opendata.swiss does not block releases.
3. A material change still blocks official redistribution until `terms.reviewedAt` and the snapshot are updated (`pnpm omc terms`).

To challenge a flag, open an issue with the `terms.url` and the passage you think we misread. Fixing it is an update to `source.yaml` plus a checksum refresh.

Fixture/CI builds set `OMC_SKIP_TERMS=1` and do not fetch live terms pages.
