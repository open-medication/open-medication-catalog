# Adding a country adapter

1. Create `adapters/<jurisdiction>/<source>/source.yaml` (licence flags, cadence, identityAuthority).
2. Implement `Adapter` in `src/adapters/<jurisdiction>/` (`metadata`, `fetch`, `validateSource`, `parse`, `normalize`, `qualityReport`). `metadata()` must read licence fields from `source.yaml` via `loadSourceDescriptor` / `metadataFromDescriptor` — do not hardcode tags.
3. Map into canonical `MedicinalProduct` (formulation/strength) and `Package`. Use optional `ProductGroup` only if the source has a real grouping (Swissmedic Präparat). Do not invent a group.
4. IDs: `canonicalId({ jurisdiction, identityAuthority, entityType, authorityKey })`. Authority keys are strings.
5. Add a recipe in `artifacts.yaml` (`fr-base`, etc.). Official CLI is `omc build <recipe-id>`.
6. Add fixtures, mapping coverage, and a country doc under `docs/countries/`.
7. FHIR exporters are country-neutral; do not special-case parsing in `src/pipeline`.

## Licence tags

Record the upstream terms before tagging. See [licences.md](licences.md) for the rubric and disclaimer.

- Set `terms.url` (and `terms.fragment` when the page defines several licences).
- After review, commit `terms.checksum` / `terms.snapshot.txt` and set `terms.reviewedAt`.
- Set `commercialUse` / `redistribution` to `allowed` only when the linked terms contain an explicit grant. Use `disallowed` for an explicit prohibition. Use `review-required` when terms are missing, gated, or ambiguous.
- Do not add the source to a public recipe while `redistribution` is `review-required` or `disallowed`.
- Set `attributionRequired` from the terms.
- If the raw dump cannot be redistributed, set `releasePolicy.redistributeRaw: false` even when derived fields are `allowed`.
