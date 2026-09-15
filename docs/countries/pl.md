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
| Active substance | `substancjaCzynna` | Medication.ingredient | Ingredient |

IDs use the same formula as Switzerland: `UUIDv5(projectNamespace, PL|rpl|{entityType}|{authorityKey})`. Swiss and French IDs are unchanged.

There is no `ProductGroup`. RPL is product + packages, not a Präparat/Sequenz tree.

Pack GTIN is emitted as `https://www.gs1.org/gtin`. ATC codes use `http://www.whocc.no/atc`. Dose form, route, and regulatory status stay RPL source text (no invented EDQM). Pack `regulatoryStatus` is withdrawn (`skasowane`) vs active (`aktywne`). Product and authorization status use the same pair: `skasowane` only when every pack is cancelled; otherwise `aktywne` (including products with no packs). MA validity (`waznoscPozwolenia`) stays in metadata — it is a date or `Bezterminowe`, not a status code. Rx/OTC (`kategoriaDostepnosci`) stays in metadata.

R4 `Medication.status` follows pack lifecycle (`aktywne` → `active`, `skasowane` → `inactive`). Active substances are `Medication.ingredient` (role `substancja czynna`). Strength stays text on the canonical row and on R5 `Ingredient`; R4 `ingredient.strength` is only emitted when a structured ratio exists.

## Reimbursement

None. RPL is not the NFZ list.

## Reproducibility

`pl-base` attaches a zip of the downloaded `overall.xml`. RPL overwrites the 6.0.0 dump in place (incremental XML was withdrawn). Releases are still tagged `pl-base-YYYY.MM`; `omc next-month pl-base` ships the current month if that tag does not already exist. Cite Centrum e-Zdrowia / URPL, CC BY 4.0, and the dump date (`stanNaDzien`).
