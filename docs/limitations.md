# Limitations

- Canonical schema is **0.1.x** until real-OGD mapping is frozen as 1.0.0.
- No prescribing, interactions, dosing, substitution, or cross-country equivalence.
- Global catalogue is a union, not a deduplicated ontology.
- FHIR IGs are not publicly packaged until `https://fhir.openmedicationcatalog.org` resolves over HTTPS. The artefact index is at `https://openmedicationcatalog.org/catalog.json`.
- R5 is IDMP-aligned, not ISO IDMP certified.
- Swissmedic routes keep Swissmedic `ROUTE_ADMIN` codes. R5 adds an EDQM coding (`http://standardterms.edqm.eu`) when the Swissmedic English UDC label equals an EDQM route-of-administration term. Veterinary and unmatched labels stay Swissmedic-only.
- BAG is not in the public `ch-enriched` recipe. Local experimental builds: `omc build ch-enriched --enable-bag` (or `OMC_ENABLE_BAG=1`); they cannot be `--publish`ed. Fetch still requires `--input` until a stable FHIR export URL is recorded.
- Sigstore/attestations are post-MVP.
