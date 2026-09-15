# Poland (PL)

## Sources

| Source | Role | Artifact |
| --- | --- | --- |
| RPL overall.xml 6.0.0 | Regulatory ground truth: products, packs, composition, MA holder | `pl-base` |

Human and veterinary rows are both mapped (`rodzajPreparatu` is a product identifier). Products without an `id` are dropped. Target species (`gatunki`) are identifiers; withdrawal periods (`okresyKarencji`) stay in metadata. NFZ reimbursement is not in RPL and is not mapped. SmPC/PIL URLs and parallel-import extras stay in metadata.

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

Pack GTIN is emitted as `https://www.gs1.org/gtin`. ATC codes use `http://www.whocc.no/atc` (including ATCvet). `rodzajPreparatu` and target species (`nazwaGatunku`) are identifiers on the product (`pl-rpl-preparation-type`, `pl-rpl-species`). Dose form, route, and regulatory status stay RPL source text (no invented EDQM). Pack `regulatoryStatus` is withdrawn (`skasowane`) vs active (`aktywne`) — that is the only RPL cancelled flag. Product and authorization status are `aktywne` while the row is in this dump (RPL has no product/MA `skasowane`). A product that disappears in a later month shows up in `changes.json`. MA validity (`waznoscPozwolenia`) stays in metadata — it is a date or `Bezterminowe`, not a status code. Rx/OTC (`kategoriaDostepnosci`) stays in metadata.

R4 `Medication.status` follows pack lifecycle (`aktywne` → `active`, `skasowane` → `inactive`). Active substances are `Medication.ingredient` (role `substancja czynna`). Strength stays text on the canonical row and on R5 `Ingredient.substance.strength.textPresentation`; R4 `ingredient.strength` is only emitted when a structured ratio exists.

Package quantity is the pack, not a single container's fill. One `jednostkaOpakowania` with `liczbaOpakowan` other than 1 becomes that count of `rodzajOpakowania` (4× fiol. 5 ml → 4 fiol.). A single container, or a row that only has `pojemnosc` (100 tabl.), uses capacity. Multiple package-unit rows stay unstructured; the full list is on canonical `packUnits` and in `description`. That structured value is R4 `Medication.amount` and R5 `PackagedProductDefinition.containedItemQuantity`.

## Reimbursement

None. RPL is not the NFZ list.

## Reproducibility

`pl-base` attaches a zip of the downloaded `overall.xml`. RPL overwrites the 6.0.0 dump in place (incremental XML was withdrawn). Releases are still tagged `pl-base-YYYY.MM`; `omc next-month pl-base` ships the current month if that tag does not already exist. Cite Centrum e-Zdrowia / URPL, CC BY 4.0, and the dump date (`stanNaDzien`).
