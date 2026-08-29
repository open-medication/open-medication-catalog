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

Custom experimental build (not publishable as official):

```bash
pnpm omc build CH --source swissmedic --source refdata --input swissmedic=./OGD.zip --input refdata=./Refdata.Articles.zip
```
