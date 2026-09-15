# Poland (PL)

## Sources

| Source | Role | Artifact |
| --- | --- | --- |
| RPL overall.xml 6.0.0 | Regulatory ground truth: products, packs, composition, MA holder | `pl-base` |

Veterinary rows (`rodzajPreparatu` other than `ludzki`) and products without an `id` are dropped. NFZ reimbursement is not in RPL and is not mapped. SmPC/PIL URLs and parallel-import extras stay in metadata.

## Identity

| Canonical | RPL | R4 | R5 |
| --- | --- | --- | --- |
| MedicinalProduct | register product `id` | Medication extension `medicinal-product-id` | MedicinalProductDefinition |
| Package | `productId\|packId` (GTIN is an identifier; it is not unique in RPL) | Medication (one per package) | PackagedProductDefinition |
| Authorization | `numerPozwolenia` (product `id` if the number is missing) | — | one RegulatedAuthorization per MA number |
| Organization | `podmiotOdpowiedzialny` (trimmed name) | Organization | Organization |

IDs use the same formula as Switzerland: `UUIDv5(projectNamespace, PL|rpl|{entityType}|{authorityKey})`. Swiss and French IDs are unchanged.

There is no `ProductGroup`. RPL is product + packages, not a Präparat/Sequenz tree.

Pack GTIN is emitted as `https://www.gs1.org/gtin`. ATC codes use `http://www.whocc.no/atc`. Dose form, route, and pack status stay RPL source text (no invented EDQM). Pack `regulatoryStatus` is withdrawn (`skasowane`) vs active (`aktywne`); Rx/OTC (`kategoriaDostepnosci`) stays in metadata.

## Reimbursement

None. RPL is not the NFZ list.

## Reproducibility

`pl-base` attaches a zip of the downloaded `overall.xml`. RPL overwrites the 6.0.0 dump in place (incremental XML was withdrawn). Releases are still tagged `pl-base-YYYY.MM`; `omc next-month pl-base` ships the current month if that tag does not already exist. Cite Centrum e-Zdrowia / URPL, CC BY 4.0, and the dump date (`stanNaDzien`).
