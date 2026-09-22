# Identifiers

UUIDv5(projectNamespace, `jurisdiction|identityAuthority|entityType|authorityKey`)

Project namespace = UUIDv5(DNS, `openmedicationcatalog.org`) = `6f62c357-cf30-5f1b-ad67-95ff1103b436`

`identityAuthority` is the issuing body (swissmedic), not the feed (OGD XML vs future FHIR API).

Example: `CH|swissmedic|MedicinalProduct|123456|01`

France uses the same formula: `FR|bdpm|MedicinalProduct|{CIS}` / `FR|bdpm|Package|{CIP13}`.

Poland uses the same formula: `PL|rpl|MedicinalProduct|{id}` / `PL|rpl|Package|{productId}|{packId}`.

The United States uses the same formula: `US|fda|MedicinalProduct|{ProductID}` / `US|fda|Package|{NDCPackageCode}`. `ProductNDC` is an identifier. The package also carries the 11-digit HIPAA NDC when the directory code is 4-4-2, 5-3-2, or 5-4-1.
