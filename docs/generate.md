# Generate a database

```bash
pnpm install
pnpm omc build ch-base --input ./OGD_202608.ZIP --month 2026.08
```

Outputs under `output/ch-base/`:

- `release/database/medication.sqlite` — query `medication_packages` or FTS
- `release/fhir-r4/*.ndjson`
- `release/fhir-r5/*.ndjson`
- `release/manifest.json`
- `release/licensing/` — upstream terms URLs, flags, checksums, and disclaimer
- `ch-base-2026.08.zip`

Live fetch uses the immutable Swissmedic archive `OGD_YYYYMM.zip` (the server uses lowercase; `.ZIP` is tried as a fallback), not the overwritten `OGD.zip`. `pnpm omc next-month ch-base` reports the newest unpublished archive relative to GitHub Releases.

Regenerate canonical TypeScript types after editing `canonical/schema/catalogue.schema.json`:

```bash
pnpm gen:types
```

Official builds fetch live licence pages and refuse to redistribute if a committed `terms.snapshot.txt` no longer matches. Swissmedic compares the `#terms_open` definition only. Fixture/CI builds set `OMC_SKIP_TERMS=1`. Check snapshots with `pnpm omc terms`.

The HL7 Java validator (`validator_cli` 6.9.12, SHA-256 in `tooling/pins.json`) is normative:

```bash
pnpm omc fhir-validate --dir output/ch-base/release
```


Custom experimental build (not publishable as official):

```bash
pnpm omc build CH --source swissmedic --source refdata --input swissmedic=./OGD.zip --input refdata=./Refdata.Articles.zip
```

Local BAG SL enrichment (not a public recipe; cannot `--publish`):

```bash
pnpm omc build ch-enriched --enable-bag --input swissmedic=./OGD.zip --input refdata=./Refdata.Articles.zip --input bag=./sl.json --month 2026.08
```

`OMC_ENABLE_BAG=1` is the same gate. BAG fetch still requires `--input` until a stable FHIR export URL is recorded. Official `ch-enriched` stays Swissmedic + Refdata.
