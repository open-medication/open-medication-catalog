import { describe, expect, it } from "vitest";
import { collectArticles, applyRefdata } from "../src/adapters/ch/refdata.js";
import { parseXmlString } from "../src/xml.js";
import { emptyCatalogue } from "../src/adapters/compose.js";
import { canonicalId } from "../src/identity.js";
import { authorityKey } from "../src/branded.js";
import { SWISSMEDIC_SYSTEMS, medicinalProductDomain, type Package, type SourceSnapshot } from "../src/canonical/types.js";
import { applyBag, BagAdapter, loadFhirResources } from "../src/adapters/ch/bag.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoPath } from "../src/paths.js";

function snap(): SourceSnapshot {
  return {
    id: "snap1",
    sourceId: "refdata",
    identityAuthority: "swissmedic",
    retrievedAt: "2026-08-31T06:00:00.000Z",
    sha256: "abc",
    uri: "file:fixture",
  };
}

describe("refdata join", () => {
  it("parses the real SIMIS Articles format and unpads swissmedic keys", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Articles xmlns="https://simisinfo.refdata.ch/Articles/1.0/" totalArticles="2" generatedOn="2026-08-31T01:00:07Z">
        <Article>
          <MedicinalProduct>
            <Identifier>CH-7601001000674-00585</Identifier>
            <Domain>Human</Domain>
            <LegalStatusOfSupply>B</LegalStatusOfSupply>
            <RegulatedAuthorisationIdentifier>0058501</RegulatedAuthorisationIdentifier>
            <ProductClassification><ProductClass>PHARMA</ProductClass><Atc>J07BK01</Atc></ProductClassification>
          </MedicinalProduct>
          <PackagedProduct>
            <Identifier>CH-7601001000674-00585-001</Identifier>
            <RegulatedAuthorisationIdentifier>00585001</RegulatedAuthorisationIdentifier>
            <DataCarrierIdentifier>7680005850010</DataCarrierIdentifier>
            <Name><Language>DE</Language><FullName>VARILRIX DE</FullName></Name>
            <Name><Language>FR</Language><FullName>VARILRIX FR</FullName></Name>
          </PackagedProduct>
        </Article>
        <Article>
          <MedicinalProduct>
            <Domain>Human</Domain>
            <ProductClassification><ProductClass>NONPHARMA</ProductClass></ProductClassification>
          </MedicinalProduct>
          <PackagedProduct>
            <RegulatedAuthorisationIdentifier>76100001</RegulatedAuthorisationIdentifier>
            <DataCarrierIdentifier>7611600441020</DataCarrierIdentifier>
          </PackagedProduct>
        </Article>
      </Articles>`;
    const articles = collectArticles(parseXmlString(xml));
    expect(articles).toHaveLength(2);
    expect(articles[0]?.gtin).toBe("7680005850010");
    expect(articles[0]?.authNr).toBe("585");
    expect(articles[0]?.packCode).toBe("1");
    expect(articles[0]?.sequence).toBe("1");
    expect(articles[0]?.productClass).toBe("PHARMA");
    expect(articles[0]?.domain).toBe("Human");
    expect(articles[0]?.atc).toBe("J07BK01");
    expect(articles[0]?.legalStatusOfSupply).toBe("B");
    expect(articles[0]?.names).toEqual([
      { language: "de", text: "VARILRIX DE" },
      { language: "fr", text: "VARILRIX FR" },
    ]);
    // NONPHARMA articles are parsed but never join medicinal-product packages.
    expect(articles[1]?.productClass).toBe("NONPHARMA");
  });

  it("joins on authorisation + pack code with padding normalization", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Articles xmlns="https://simisinfo.refdata.ch/Articles/1.0/">
        <Article>
          <MedicinalProduct>
            <Domain>Human</Domain>
            <RegulatedAuthorisationIdentifier>0058501</RegulatedAuthorisationIdentifier>
            <ProductClassification><ProductClass>PHARMA</ProductClass></ProductClassification>
          </MedicinalProduct>
          <PackagedProduct>
            <RegulatedAuthorisationIdentifier>00585001</RegulatedAuthorisationIdentifier>
            <DataCarrierIdentifier>7680005850010</DataCarrierIdentifier>
            <Name><Language>DE</Language><FullName>VARILRIX DE</FullName></Name>
          </PackagedProduct>
        </Article>
      </Articles>`;
    const articles = collectArticles(parseXmlString(xml));

    const cat = emptyCatalogue("custom-ch", "CH", "0.1.0");
    const pkgId = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      entityType: "Package",
      authorityKey: authorityKey(["585", "01", "1"]),
    });
    const mpId = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      entityType: "MedicinalProduct",
      authorityKey: authorityKey(["585", "01"]),
    });
    const pkg: Package = {
      id: pkgId,
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      authorityKey: "585|01|1",
      medicinalProductId: mpId,
      domain: medicinalProductDomain("Human"),
      description: "585 10 tablet(s)",
      quantity: { structured: false },
      regulatoryStatus: { system: SWISSMEDIC_SYSTEMS.regulatoryStatus, code: "Z" },
      identifiers: [{ system: SWISSMEDIC_SYSTEMS.package, value: "585|01|1" }],
      fieldProvenance: {},
      sourceRecords: [],
    };
    cat.packages.push(pkg);
    cat.sourceSnapshots.push(snap());
    applyRefdata(cat, articles, snap());
    expect(pkg.gtin).toBe("7680005850010");
    expect(pkg.identifiers.some((i) => i.system === "https://www.gs1.org/gtin" && i.value === "7680005850010")).toBe(true);
    expect(pkg.names).toEqual([{ language: "de", text: "VARILRIX DE" }]);
    expect(pkg.fieldProvenance.gtin?.originalField).toBe("PackagedProduct/DataCarrierIdentifier");
  });

  it("does not join articles across human/veterinary domains", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Articles xmlns="https://simisinfo.refdata.ch/Articles/1.0/">
        <Article>
          <MedicinalProduct>
            <Domain>Human</Domain>
            <ProductClassification><ProductClass>PHARMA</ProductClass></ProductClassification>
          </MedicinalProduct>
          <PackagedProduct>
            <RegulatedAuthorisationIdentifier>90001001</RegulatedAuthorisationIdentifier>
            <DataCarrierIdentifier>7680900010018</DataCarrierIdentifier>
            <Name><Language>DE</Language><FullName>Wrong-domain name</FullName></Name>
          </PackagedProduct>
        </Article>
      </Articles>`;
    const articles = collectArticles(parseXmlString(xml));

    const cat = emptyCatalogue("custom-ch", "CH", "0.1.0");
    const pkgId = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      entityType: "Package",
      authorityKey: authorityKey(["90001", "1", "1"]),
    });
    const mpId = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      entityType: "MedicinalProduct",
      authorityKey: authorityKey(["90001", "1"]),
    });
    const pkg: Package = {
      id: pkgId,
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      authorityKey: "90001|1|1",
      medicinalProductId: mpId,
      domain: medicinalProductDomain("Veterinary"),
      description: "1 10 ml",
      quantity: { structured: false },
      regulatoryStatus: { system: SWISSMEDIC_SYSTEMS.regulatoryStatus, code: "Z" },
      identifiers: [{ system: SWISSMEDIC_SYSTEMS.package, value: "90001|1|1" }],
      fieldProvenance: {},
      sourceRecords: [],
    };
    cat.packages.push(pkg);
    cat.sourceSnapshots.push(snap());
    applyRefdata(cat, articles, snap());
    expect(pkg.gtin).toBeUndefined();
    expect(pkg.names).toBeUndefined();
  });

  it("skips articles without a data carrier identifier instead of crashing", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Articles xmlns="https://simisinfo.refdata.ch/Articles/1.0/">
        <Article>
          <MedicinalProduct>
            <Domain>Human</Domain>
            <ProductClassification><ProductClass>PHARMA</ProductClass></ProductClassification>
          </MedicinalProduct>
          <PackagedProduct>
            <RegulatedAuthorisationIdentifier>99998001</RegulatedAuthorisationIdentifier>
            <Name><Language>DE</Language><FullName>Erythrozytenkonzentrat</FullName></Name>
          </PackagedProduct>
        </Article>
      </Articles>`;
    const articles = collectArticles(parseXmlString(xml));
    expect(articles[0]?.gtin).toBeUndefined();
    expect(articles[0]?.authNr).toBe("99998");
  });
});

describe("BAG CH EPL pin", () => {
  it("fails when meta.profile advertises a newer CH EPL version", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omc-bag-"));
    const file = path.join(dir, "bundle.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        resourceType: "PackagedProductDefinition",
        id: "1",
        meta: { profile: ["http://fhir.ch/ig/ch-epl/2.0.0/StructureDefinition/foo"] },
      }),
    );
    const adapter = new BagAdapter();
    await expect(
      adapter.validateSource(
        {
          cacheDir: dir,
          secrets: {},
          releaseMonth: "2026.09",
          cutoffDate: "2026-08-31",
          archiveMonth: "202609",
        },
        {
          files: [file],
          snapshot: {
            id: "x",
            sourceId: "bag",
            identityAuthority: "bag",
            retrievedAt: "2026-08-31T06:00:00.000Z",
            sha256: "x",
            uri: "file:x",
          },
        },
      ),
    ).rejects.toThrow(/CH EPL/);
  });
});

describe("BAG join", () => {
  it("joins CH EPL reimbursementSL on packaging GTIN", () => {
    const cat = emptyCatalogue("custom-ch", "CH", "0.1.0");
    const pkgId = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      entityType: "Package",
      authorityKey: authorityKey(["10029", "2", "2"]),
    });
    const mpId = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      entityType: "MedicinalProduct",
      authorityKey: authorityKey(["10029", "2"]),
    });
    const pkg: Package = {
      id: pkgId,
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      authorityKey: "10029|2|2",
      medicinalProductId: mpId,
      domain: medicinalProductDomain("Human"),
      description: "200 ML",
      quantity: { structured: false },
      gtin: "7680687930017",
      regulatoryStatus: { system: SWISSMEDIC_SYSTEMS.regulatoryStatus, code: "Z" },
      identifiers: [{ system: SWISSMEDIC_SYSTEMS.package, value: "10029|2|2" }],
      fieldProvenance: {},
      sourceRecords: [],
    };
    cat.packages.push(pkg);
    const bagSnap: SourceSnapshot = {
      id: "bagsnap",
      sourceId: "bag",
      identityAuthority: "bag",
      retrievedAt: "2026-08-31T06:00:00.000Z",
      sha256: "bag",
      uri: "file:fixture",
    };
    cat.sourceSnapshots.push(bagSnap);
    applyBag(cat, loadFhirResources([repoPath("fixtures/ch/bag/epl-paxlovid.json")]), bagSnap);
    expect(pkg.reimbursementStatus?.code).toBe("756001002001");
    expect(cat.reimbursements).toHaveLength(1);
    const row = cat.reimbursements[0]!;
    expect(row.status.code).toBe("756001021001");
    expect(row.dossierNumber).toBe("21529");
    expect(row.costShare).toBe(10);
    expect(row.gamme?.display).toBe("Oral");
    expect(row.prices).toHaveLength(2);
    expect(row.price?.value).toBe("1113.95");
    expect(row.limitations).toMatch(/PAXLOVID/);
    expect(row.validFrom).toBe("2023-12-01");
    expect(row.firstListingDate).toBe("2023-12-01");
  });
});
