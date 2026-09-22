# Limitations

- Canonical schema is **0.1.x** until mapping is frozen as 1.0.0.
- SQLite tables will change as more countries are added. FHIR R4/R5 is the stable interchange format.
- No prescribing, interactions, dosing, substitution, or cross-country equivalence.
- Global catalogue is a union, not a deduplicated ontology.
- FHIR IGs are not publicly packaged until `https://fhir.openmedicationcatalog.org` resolves over HTTPS. The artefact index is at `https://openmedicationcatalog.org/catalog.json`.
- R5 is IDMP-aligned, not ISO IDMP certified.
- Swissmedic routes keep Swissmedic `ROUTE_ADMIN` codes. R5 adds an EDQM coding (`http://standardterms.edqm.eu`) when the Swissmedic English UDC label equals an EDQM route-of-administration term. Veterinary and unmatched labels stay Swissmedic-only.
- BAG is not in the public `ch-enriched` recipe. Local experimental builds: `omc build ch-enriched --enable-bag` (or `OMC_ENABLE_BAG=1`); they cannot be `--publish`ed. Fetch still requires `--input` until a stable FHIR export URL is recorded. Veterinary recipes (`ch-vet-base`, `ch-vet-enriched`) do not use BAG.
- Official recipes split human vs veterinary (`ch-base` / `ch-vet-base`, `pl-base` / `pl-vet-base`). `pl-base` is RPL `ludzki` only. NFZ reimbursement is not in RPL and is not mapped.
- `us-base` is the FDA NDC Directory of finished marketed drugs (`ndctext.zip`). Animal drugs are not in that directory. Unfinished, compounded, and excluded listing files are not mapped. An NDC listing is not an FDA approval and not a coverage decision. The uniform 12-digit NDC format takes effect in 2033; releases keep the hyphenated directory code and the 11-digit HIPAA form.
- ATCvet codes in RPL (for example `QI09AL01`) are emitted on `http://www.whocc.no/atc`, the same system as human ATC.
- Sigstore/attestations are post-MVP.
