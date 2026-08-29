# Adding a country adapter

1. Create `adapters/<jurisdiction>/<source>/source.yaml` (licence, cadence, identityAuthority).
2. Implement `Adapter` in `src/adapters/<jurisdiction>/` (`metadata`, `fetch`, `validateSource`, `parse`, `normalize`, `qualityReport`).
3. Map into canonical `MedicinalProduct` (formulation/strength) and `Package`. Use optional `ProductGroup` only if the source has a real grouping (Swissmedic Präparat). Do not invent a group.
4. IDs: `canonicalId({ jurisdiction, identityAuthority, entityType, authorityKey })`. Authority keys are strings.
5. Add a recipe in `artifacts.yaml` (`fr-base`, etc.). Official CLI is `omc build <recipe-id>`.
6. Add fixtures, mapping coverage, and a country doc under `docs/countries/`.
7. FHIR exporters are country-neutral; do not special-case parsing in `src/pipeline`.
