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
- `ch-base-2026.08.zip`

Live fetch uses the immutable Swissmedic archive `OGD_YYYYMM.ZIP`, not the overwritten `OGD.zip`.

Regenerate canonical TypeScript types after editing `canonical/schema/catalogue.schema.json`:

```bash
pnpm gen:types
```

Official builds fetch live licence pages and refuse to redistribute if a committed `terms.snapshot.txt` no longer matches. Fixture/CI builds set `OMC_SKIP_TERMS=1`. Check snapshots with `pnpm omc terms`.

The HL7 Java validator (`validator_cli` 6.9.12, SHA-256 in `tooling/pins.json`) is normative:

```bash
pnpm omc fhir-validate --dir output/ch-base/release
```


Custom experimental build (not publishable as official):

```bash
pnpm omc build CH --source swissmedic --source refdata --input swissmedic=./OGD.zip --input refdata=./Refdata.Articles.zip
```
