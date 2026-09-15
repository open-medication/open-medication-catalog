# `pl-catalogue` branch audit

Date: 2026-09-15  
Compared with: `origin/main` at `65afaeb`  
Branch head: `262320b`  
Scope: Polish RPL source mapping, canonical model, SQLite, FHIR R4/R5, comparison with Swiss and French exporters, tests, and shared TypeScript architecture.

## Executive summary

The branch successfully wires Poland into the complete release pipeline as the official `pl-base` artifact. Identity design, GTIN handling as a non-unique identifier, human/veterinary filtering, licensing, release discovery, and fixture coverage are generally coherent.

It should not be released unchanged, however. There are four release-blocking findings:

1. Every text-only R5 `Ingredient` is invalid FHIR because it emits `strength.text`, which does not exist in R5.
2. R4 ingredient coding identifies the role (`substancja czynna`) as the substance.
3. Polish pack quantities use the first container's capacity while ignoring container count and additional package units.
4. Fields promised as `retained-as-metadata` are silently discarded, including 30,457 manufacturer rows in the current live source.

The current validator command does not detect the first problem because it validates only R4 `Medication` and R5 `MedicinalProductDefinition`, omitting all other generated resource types.

## Evidence base

- Reviewed all 16 branch commits and the full `origin/main...HEAD` diff.
- Inspected the live `pl-base` release generated from RPL `overall.xml` dated 2026-09-15.
- Analyzed 20,266 human medicinal products and 75,592 generated packages.
- Compared the current Polish release with the generated Swiss release and fresh French/Swiss fixture builds.
- Queried `medication.sqlite` and streamed the generated NDJSON files.
- Verified zero Polish ID-set mismatches between SQLite packages/products and their R4/R5 projections.
- Verified zero duplicate FHIR resource IDs, JSON parse failures, or broken R5 `packageFor`, `Ingredient.for`, authorization subject, and authorization holder references.
- Ran `pnpm test` and `pnpm typecheck`: 74 tests passed; TypeScript passed.
- Generated the SUSHI profiles and ran HL7 Validator 6.9.12.
- The standard project validation passed its limited sample. Direct validation of omitted R5 resources failed on `Ingredient.substance.strength[0].text`.

Official FHIR references:

- [FHIR R4 Medication](https://hl7.org/fhir/R4/medication.html)
- [FHIR R5 Ingredient](https://hl7.org/fhir/R5/ingredient.html)
- [FHIR R5 MedicinalProductDefinition](https://hl7.org/fhir/R5/medicinalproductdefinition.html)
- [FHIR R5 PackagedProductDefinition](https://hl7.org/fhir/R5/packagedproductdefinition.html)
- [FHIR R5 RegulatedAuthorization](https://hl7.org/fhir/R5/regulatedauthorization.html)

## P0 — release blockers

### P0.1 R5 Ingredient resources are invalid FHIR

Definite validity failure.

`src/fhir/r5.ts:151-172` emits either:

```json
{ "presentationRatio": { "...": "..." }, "text": "..." }
```

or:

```json
{ "text": "..." }
```

inside `Ingredient.substance.strength`. R5 defines `textPresentation` and `textConcentration`; it does not define `text`.

Direct validation result:

```text
Ingredient.substance.strength[0]:
Error - Unrecognized property 'text'
```

Impact:

- All 25,527 Polish `Ingredient.ndjson` rows use this invalid shape.
- The same shared exporter defect affects French and Swiss ingredients.
- Consumers using strict FHIR parsers may reject the whole file.

Why CI misses it:

- `src/pipeline/validator.ts:92-124` validates only:
  - R4 `Medication.ndjson`
  - R5 `MedicinalProductDefinition.ndjson`
- It does not validate R5 `Ingredient`, `PackagedProductDefinition`, `RegulatedAuthorization`, or `Organization`.
- It samples only the first `max` records of the two included files.

Recommended fix:

1. Emit `textPresentation` or `textConcentration`.
2. Use `presentationRatio` for amount per presentation and `concentrationRatio` for amount per mass/volume.
3. Discover and validate every NDJSON file in both FHIR directories.
4. Add a test that directly validates or structurally asserts each generated resource type.

### P0.2 R4 ingredient coding identifies the role, not the substance

Definite semantic error.

`src/fhir/r4.ts:87-97` emits:

```json
{
  "itemCodeableConcept": {
    "text": "Paliperidonum",
    "coding": [{
      "system": ".../pl-rpl-ingredient-role",
      "code": "substancja czynna"
    }]
  }
}
```

FHIR R4 `Medication.ingredient.item[x]` represents the actual ingredient. The active/inactive distinction belongs in `Medication.ingredient.isActive`.

Impact:

- The coding and text disagree.
- Token search by ingredient code sees the same role code for every active ingredient.
- This affects 63,387 Polish package-level R4 Medications containing ingredients.
- Across those package-level resources, all 84,416 emitted R4 ingredient entries lack a substance coding.
- The same shared exporter bug affects Swiss roles such as `WIRKS` and French roles such as `SA`.

Recommended fix:

1. Code the substance using the canonical substance identifier or a standard substance terminology.
2. Set `isActive: true` for canonical active ingredients.
3. Do not place ingredient-role coding in `itemCodeableConcept`.
4. Replace string-based role filtering with a canonical role enum or a system-aware mapping.

### P0.3 Package quantity is derived from container capacity, not pack size

Definite data-mapping error.

`src/adapters/pl/rpl.ts:420-428` reads only the first `jednostkaOpakowania` and maps:

- `pojemnosc` to quantity value
- `jednostkaPojemnosci` to quantity unit

It ignores:

- `liczbaOpakowan`
- `rodzajOpakowania`
- every package unit after the first

That value is then exported as:

- R4 `Medication.amount` in `src/fhir/r4.ts:86`
- R5 `PackagedProductDefinition.containedItemQuantity` in `src/fhir/r5.ts:107`

Concrete fixture example:

- 1 vial × 5 ml becomes 5 ml.
- 4 vials × 5 ml also becomes 5 ml.
- 10 vials × 5 ml also becomes 5 ml.

Live-source impact:

- 73,210 of 75,592 Polish packages emit a structured amount.
- 9,404 eligible packages contain a container count greater than one.
- 1,593 eligible packages have multiple `jednostkaOpakowania` rows.
- A package described as `1× amp.-strzyk. 50 mg; 2× igły` is emitted as an amount of 50 mg, although 50 mg is container content, not the complete package structure.

FHIR R5 defines `containedItemQuantity` as the complete count of contained items of a type. Detailed container hierarchy belongs under `PackagedProductDefinition.packaging`.

Comparison:

- Switzerland maps a source pack-size field and suppresses ambiguous multi-pack structures.
- France leaves package quantity unstructured rather than inventing a number.
- Poland exposes more structured package data than either source, but currently collapses it incorrectly.

Recommended fix:

1. Extend the canonical package model to retain all package-unit rows.
2. Map `liczbaOpakowan` and `rodzajOpakowania` to the package/container count and type.
3. Keep capacity as contained-item amount or nested packaging data.
4. Emit no structured quantity when a faithful single quantity cannot be derived.
5. Add regression tests for 1×5 ml, 4×5 ml, 10×5 ml, and multi-component packs.

### P0.4 Fields classified as retained metadata are silently dropped

Definite mapping-contract violation.

`adapters/pl/rpl/mapping.yaml` says unknown fields must not be silently ignored and classifies several fields as `retained-as-metadata`. `src/adapters/pl/rpl.ts:216-233` and `:283-291` retain only a subset.

Dropped groups include:

- manufacturers and importer/manufacturer countries
- patient educational materials
- clinician educational materials
- export-country and export-country authorization-holder data

The export-country fields are attributes of nested `wytworcy` rows in the live XML, not product attributes. The current normalizer does not traverse those rows.

Live-source impact:

- 20,258 of 20,266 human products have manufacturer data.
- 30,457 manufacturer rows are discarded.
- 998 products have patient educational materials.
- 863 products have clinician educational materials.
- 2,461 educational-material rows with URLs are discarded.
- 4,340 manufacturer rows carry an export country and export-country authorization holder that are discarded.

Coverage still reports `unknownFields: []`, so the official quality report presents these fields as handled.

Recommended fix:

1. Preserve these values in canonical metadata or add modeled entities/relationships.
2. If they are intentionally out of scope, reclassify them as `intentionally-ignored` and document why.
3. Make mapping coverage verify that `retained-as-metadata` fields actually reach metadata.
4. Add fixture assertions for manufacturer and educational-material retention.

## P1 — high-priority correctness and interoperability

### P1.1 R5 loses the only withdrawn-package signal

`src/adapters/pl/rpl.ts:431-440` correctly distinguishes active and `skasowane` packages. R4 maps that to `Medication.status`.

`src/fhir/r5.ts:83-116` emits neither:

- `PackagedProductDefinition.status`
- Polish `marketingStatus`
- a regulatory-status extension

Impact:

- 4,104 withdrawn Polish packages are indistinguishable from active packages in R5.
- A consumer using only R5 cannot reproduce the lifecycle information available in R4 and SQLite.

Recommended fix:

- Preserve source regulatory status explicitly on R5 PPD.
- Map to `marketingStatus` only if the source semantics support market availability.
- Use PPD `status` only for the resource publication lifecycle.

### P1.2 Ingredient strengths are unnecessarily unstructured

`src/adapters/pl/rpl.ts:472-539` always creates:

```ts
strength: { text: strengthText, structured: false }
```

This happens even when RPL supplies numeric numerator and denominator fields.

Live-source evidence:

- 29,165 source active-substance rows were inspected.
- 24,144 have numeric values that are candidates for structured mapping.
- All 25,527 generated Polish canonical ingredients are marked unstructured.
- Consequently, zero Polish R4 ingredients have `strength`.

Example:

- Source: 4 mg per 5 ml.
- Canonical: text only.
- R4: strength omitted.
- R5: invalid text-only strength due to P0.1.

Recommended fix:

- Parse numerator and denominator independently with comma-decimal support.
- Map units to UCUM where possible.
- Preserve source text alongside structured values.
- Treat compound source units such as `mg/g` carefully instead of using them as a numerator unit.

### P1.3 ATC is modeled as identity and the quality report is false

`src/adapters/pl/rpl.ts:209-218` stores ATC as:

- a `MedicinalProduct.identifier`
- duplicated text in metadata

R5 copies it to `MedicinalProductDefinition.identifier`. FHIR R5 provides `MedicinalProductDefinition.classification` for ATC-like classifications.

The canonical model has ATC only on `ProductGroup`, but Poland and France intentionally have no product groups. `src/pipeline/quality.ts:30-51` therefore divides a product-group ATC count by product-group count and reports 0%.

Live output:

- 19,159 of 20,266 Polish products carry an ATC identifier: 94.5%.
- `quality-report.json` says `percentProductsWithAtc: 0`.
- SQLite has an `atc_code` column only on the empty `product_group` table.

Recommended fix:

1. Add a product-level classification collection to the canonical schema.
2. Map ATC to R5 `classification`.
3. Decide explicitly whether ATC should also be a secondary R4 `Medication.code.coding`.
4. Derive quality metrics from the canonical classification regardless of country hierarchy.
5. Expose product classification in SQLite.

### P1.4 Product and authorization status is asserted without source support

`src/adapters/pl/rpl.ts:198-208` and `:236-247` assign the invented local code `aktywne` to every included medicinal product and authorization.

RPL provides:

- package `skasowane`
- authorization validity as a date, `Bezterminowe`, blank, or another source value

Presence in the dump proves listing, but it does not itself prove an active marketing authorization status.

Live-source evidence:

- 8,372 human products say `Bezterminowe`.
- 8,128 contain a validity date.
- 3,748 are blank.
- 2,320 validity dates are before 2026-09-15.
- 18 explicitly say `Pozwolenie zawieszone`, but are still exported as `aktywne`.

An earlier validity date does not by itself prove withdrawal, because renewal procedures may affect interpretation. It does prove that unconditional `aktywne` is not derived from the supplied field.

R5 also uses these local codes in `MedicinalProductDefinition.status` and `RegulatedAuthorization.status`, where the preferred concept is publication status.

Recommended fix:

- Use a neutral canonical `listed`/`unknown` state when the source has no authoritative status.
- Map `Pozwolenie zawieszone` explicitly rather than overwriting it with `aktywne`.
- Preserve and model authorization validity as `RegulatedAuthorization.validityPeriod`.
- Keep package cancellation separate.
- Emit FHIR publication status independently from regulatory status.

### P1.5 Polish FHIR package names omit the medicinal product name

`src/adapters/pl/rpl.ts:277` sets `Package.names` to the package description itself. `src/fhir/translation.ts:40-42` then prefers that value over the richer R4 fallback built in `src/fhir/r4.ts:55-59`.

Result:

- All 75,592 Polish R4 `Medication.code.text` values are packaging descriptions such as `30 tabl.` or `1× amp.-strzyk. 50 mg; 2× igły`.
- None of the inspected Polish records use the product-name-plus-package fallback used by the Swiss R4 output.
- R5 PPD names have the same limitation.

France has a similar weak pattern; Switzerland's R4 output normally includes the medicinal product name.

Impact:

- Human-readable FHIR records cannot be identified without resolving the custom medicinal-product-id extension or external joins.
- Many distinct medications share displays such as `30 tabl.`.

Recommended fix:

- Do not populate `Package.names` with a duplicate of `description`.
- Build the catalogue name from product name plus package description.
- Reserve package localized names for genuine authority-provided trade/package names.

### P1.6 SQLite is not a faithful projection of the Polish canonical data

`src/sqlite/writer.ts` stores a useful package-search subset, but drops or flattens much of the RPL data:

- routes are omitted
- authorization-to-product membership is omitted
- authorization validity and product metadata are omitted
- declaration rows are omitted
- structured numerator/denominator fields are omitted
- substances are omitted as entities
- ATC is available only indirectly through the generic identifier table
- only the first product name is stored, so the common name/INN is lost
- code systems are discarded for dose form, status, ingredient role, and quantity unit
- organization and authorization identifiers are not inserted into the generic identifier table

Impact:

- SQLite and FHIR are not equivalent views of the canonical catalogue.
- Queries cannot reliably distinguish local codes from displays.
- Polish route, INN, validity, and detailed composition data cannot be queried.

Recommended fix:

- Define which canonical fields SQLite guarantees to preserve.
- Add normalized tables for classifications, names, routes, authorization subjects, declarations, and coded values.
- Add foreign keys and indexes.
- Add cross-format parity tests from one canonical fixture.

### P1.7 Centralized EU authorization identifiers are not projected

For products without `numerPozwolenia`, `src/adapters/pl/rpl.ts:160-173` falls back to the RPL product ID as the authorization key and identifier.

Live-source evidence:

- 3,832 eligible human products have no `numerPozwolenia`.
- 14,578 eligible package rows carry `numerEu`.
- Those EU identifiers remain only in package metadata.
- R5 `RegulatedAuthorization.identifier` therefore contains an RPL product ID for centralized products instead of the available EU authorization identity.

Recommended fix:

- Derive and retain the appropriate product-level EU authorization identifier from distinct `numerEu` values.
- Keep the full presentation-level EU number on the package.
- Do not present the fallback RPL product ID as if it were an authorization number; identify it with its actual system and fallback purpose.
- Add centralized-product fixtures and tests before defining grouping rules, because presentation suffixes must not create duplicate authorizations.

### P1.8 Raw `overall.xml` cannot be used with `--input`

The live endpoint publishes XML and the network fetch path accepts XML. `src/adapters/pl/rpl.ts:604-637`, however, accepts only:

- a directory containing `overall.xml`
- a ZIP containing `overall.xml`

Passing the downloaded source file directly fails with:

```text
RPL input must be a zip containing overall.xml or a directory containing it
```

CI does not cover this because the fixture is pre-wrapped in a ZIP.

Recommended fix:

- Accept an XML file when `fileSignatureOk(buf, "xml")` succeeds.
- Copy it into the normalized work directory and create the deterministic source archive.
- Add a raw-XML input test.

### P1.9 Local code systems are referenced but not defined

The generated resources reference Polish systems for:

- dose form
- route
- regulatory status
- ingredient role
- package and quantity units

The SUSHI IG does not include corresponding `CodeSystem` resources. HL7 Validator therefore warns that these systems cannot be validated.

Recommended fix:

- Generate and publish source CodeSystems, including definitions and case-sensitivity.
- Prefer standard EDQM/UCUM codes where a verified mapping exists.
- Preserve the original RPL display and local coding as additional coding.

## P2 — maintainability and clean-code concerns

### P2.1 Shared R4 exporter contains a growing country-code switch

`src/fhir/r4.ts:9-28` now knows Swiss, French, and Polish raw role/status strings.

This conflicts with the documented goal of country-neutral exporters and will grow for each adapter.

Recommended fix:

- Normalize lifecycle and ingredient role in adapters.
- Use canonical enums such as active/inactive ingredient and active/inactive/unknown catalogue record.
- If source coding must remain, compare both `system` and `code`, never an unqualified display-like string.

### P2.2 The global XML parser is coupled to RPL vocabulary

`src/xml.ts` adds Polish tag names to a global array-tag set while `src/adapters/pl/rpl-xml.ts` separately defines the same vocabulary.

Recommended fix:

- Let each adapter pass its repeating tag names to the parser.
- Keep `RplXml` as the single source of RPL element names.
- Avoid changing parsing behavior globally when adding a country.

### P2.3 `RplAdapter` mixes too many responsibilities

`src/adapters/pl/rpl.ts` is 663 lines and combines:

- source URL/config loading
- network retrieval
- input archive handling
- XML field coverage
- source filtering
- organization and authorization aggregation
- product, package, and ingredient normalization
- metadata flattening
- recursive filesystem search

It also imports `SourceNotYetAvailableError` from the Swiss adapter. Similar source/input handling exists in the French adapter.

Recommended refactor:

- Move source availability errors to shared adapter types.
- Extract reusable XML/ZIP input acquisition.
- Split RPL parsing, normalization, package mapping, and composition mapping into focused modules.
- Add unit tests for package quantity, GTIN, composition, status, and human-product classification.

### P2.4 Mapping coverage is name-based, not path- or behavior-based

`walkFieldNames` records only element/attribute names. The same name in a different XML context is treated as covered, and classification does not prove retention.

Recommended fix:

- Track qualified structural paths.
- Associate each mapped path with its destination field or explicit ignore reason.
- Assert non-zero destination coverage for fields classified as mapped or retained.

### P2.5 Missing preparation type is counted as veterinary

`src/adapters/pl/rpl.ts:365-367` treats anything other than exact `ludzki` as non-human. The parse report counts missing or unknown values as `ignoredVeterinary`.

Recommended fix:

- Distinguish human, veterinary, and unknown/incomplete preparation types.
- Do not mislabel incomplete source data as veterinary.

### P2.6 GTIN syntax is checked, but check digits are not

`src/adapters/pl/rpl.ts:386-389` strips non-digits and accepts any 13- or 14-digit result.

The current output contains:

- 67,869 GTIN-bearing packages
- 3 duplicated GTIN values, which RPL legitimately permits
- 5 values with invalid GTIN check digits

Recommended fix:

- Preserve the raw source value.
- Emit a GS1 GTIN identifier only when length and check digit are valid.
- Report rejected values in quality metrics rather than silently normalizing punctuation away.

### P2.7 FHIR profiles and documentation remain Swiss-centric

The shared FSH profile descriptions still refer to Swissmedic Packung and Refdata behavior while the profile is asserted by Polish and French resources.

Recommended fix:

- Rewrite shared profile descriptions in country-neutral language.
- Move country-specific behavior into implementation guides or invariant documentation.

### P2.8 Cardinality and source-quality edge cases need explicit policy

The live output is referentially consistent, but contains legitimate edge cases that should be documented and regression-tested:

- 944 medicinal products have no active-substance rows.
- One medicinal product (`100540826`, Adstiladrin) has no package.
- Two authorizations have no holder because the source holder is empty.
- One authorization number (`IL-1024/LN`) is shared by two medicinal products.
- 71 products repeat the same ingredient name within one product; this may represent source declaration components rather than duplicate ingredients.
- 44 products carry multiple ATC values.
- 661 ATC values are shorter than seven characters and may represent higher-level classifications rather than complete fifth-level ATC codes.
- 20,260 of 20,266 products have a second canonical name, usually the common name/INN, but R5 MPD and SQLite keep only the first.

Recommended fix:

- Preserve source cardinality unless a deduplication rule is documented and provenance-aware.
- Distinguish ingredient declaration rows/components from deduplicated substance identities.
- Validate ATC syntax by level without rejecting legitimate higher-level classifications.
- Add quality-report counters for products without packages, products without ingredients, holderless authorizations, and repeated declaration substances.

### P2.9 Polish display text is used as FHIR `code`

`coded()` uses `fhirCode(display)`, which normalizes whitespace but does not create a stable terminology code.

Live output:

- 63,992 of 75,592 R4 package dose-form codings contain spaces.
- 16,285 of 20,266 R5 product dose-form codings contain spaces.
- Routes and statuses similarly use Polish source labels as codes.

This is syntactically valid FHIR `code`, but weak for interoperability and sensitive to source spelling changes. Switzerland generally has authority tokens for dose form and adds verified EDQM route coding; France follows a display-as-code pattern similar to Poland.

Recommended fix:

- Treat source labels as displays under a clearly versioned local CodeSystem.
- Define stable local codes or add verified EDQM/SNOMED/UCUM codings.
- Do not derive identity-sensitive behavior from normalized display strings.

## Test gaps

The Polish integration test covers core wiring, identity, filtering, duplicate GTIN behavior, one ingredient name, package status, licensing, and basic file presence. It does not test the semantics that failed this audit.

Add tests for:

1. Every generated NDJSON resource type passing the correct FHIR validator.
2. R4 ingredient substance coding and `isActive`.
3. Structured 4 mg / 5 ml strength.
4. 1×, 4×, and 10× 5 ml package distinctions.
5. Multi-row package units.
6. R5 withdrawn package visibility.
7. ATC quality reporting, R5 classification, and SQLite querying.
8. Manufacturer and educational-material retention.
9. Centralized EU authorization identifiers.
10. Raw XML `--input`.
11. Product name plus package description in FHIR displays.
12. Unknown preparation type reporting.
13. Cross-format canonical/FHIR/SQLite parity.
14. A Swiss R4 ingredient regression assertion after changing shared role logic.

## Positive findings

- `pl-base` is consistently wired through artifact recipes, CLI help, discovery, CI, release workflow, site metadata, licensing, and documentation.
- Package authority keys use `productId|packId`, avoiding incorrect GTIN uniqueness assumptions.
- Stable UUIDv5 identity is tested.
- Veterinary and identifier-less fixture rows are excluded and counted.
- GTIN uses the expected GS1 URI and remains an identifier.
- R4 package status maps `aktywne`/`skasowane` to the required `active`/`inactive` codes.
- R5 references from package to medicinal product and ingredient to medicinal product are structurally valid.
- Polish resource IDs, cross-resource references, and SQLite entity joins have exact parity with no duplicate resource IDs or broken references in the inspected release.
- The source dump date is preserved as `sourceEffectiveDate`.
- The complete branch passes its TypeScript and unit/integration test suites.

## Recommended implementation order

1. Fix R5 Ingredient element names and expand validation to every resource file.
2. Fix R4 ingredient identity/role mapping.
3. Remodel Polish package units and suppress ambiguous quantities until that model is available.
4. Enforce the mapping contract for retained metadata.
5. Preserve withdrawn status in R5.
6. Structure ingredient strengths.
7. Add canonical product classifications and correct ATC reporting/export.
8. Correct human-readable package names.
9. Model authorization validity without asserting unsupported active status.
10. Project centralized EU authorization identifiers.
11. Bring SQLite to an explicitly documented parity level.
12. Accept raw XML input.
13. Refactor shared country-neutral status/role/XML infrastructure.

