# Licences

The **generator** is Apache-2.0.

Upstream data is **not** Apache-2.0:

| Source | Commercial use | Redistribution | Attribution |
| --- | --- | --- | --- |
| Swissmedic OGD | allowed (`terms_open`) | allowed | recorded |
| Refdata | allowed | derived fields; not the credential-gated ZIP | required if fields unchanged |
| BAG SL | review-required | review-required | TBD |

Terms pages are checksummed (`adapters/ch/*/terms.snapshot.txt` and `terms.checksum` in each `source.yaml`). Swissmedic hashes the `#terms_open` definition only, so CMS chrome on opendata.swiss does not block releases. A material change to that definition still blocks official redistribution until `terms.reviewedAt` and the snapshot are updated.
