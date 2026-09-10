import { describe, expect, it } from "vitest";
import { collectArticles, applyRefdata } from "../src/adapters/ch/refdata.js";
import { parseXmlString } from "../src/xml.js";
import { emptyCatalogue } from "../src/adapters/compose.js";
import { canonicalId } from "../src/identity.js";
import { authorityKey } from "../src/branded.js";
import { SWISSMEDIC_SYSTEMS, type Package, type SourceSnapshot } from "../src/canonical/types.js";
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
    retrievedAt: "1970-01-01T00:00:00.000Z",
    sha256: "abc",
    uri: "file:fixture",
  };
}

describe("refdata join", () => {
  it("joins on authorisation + pack code as strings", () => {
    const xml = `<?xml version="1.0"?><ARTICLES>
      <ARTICLE><GTIN>7680123450017</GTIN><AUTHNR>001</AUTHNR><PACKCODE>001</PACKCODE><STATUS>inCommerce</STATUS><NAME_DE>Prednison DE</NAME_DE><NAME_FR>Prednisone FR</NAME_FR><VALIDFROM>2020-01-01</VALIDFROM><VALIDTO>2099-12-31</VALIDTO></ARTICLE>
    </ARTICLES>`;
    const articles = collectArticles(parseXmlString(xml));
    expect(articles[0]?.authNr).toBe("001");
    expect(articles[0]?.packCode).toBe("001");
    expect(articles[0]?.gtin).toBe("7680123450017");

    const cat = emptyCatalogue("custom-ch", "CH", "0.1.0");
    const pkgId = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      entityType: "Package",
      authorityKey: authorityKey(["001", "01", "001"]),
    });
    const mpId = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      entityType: "MedicinalProduct",
      authorityKey: authorityKey(["001", "01"]),
    });
    const pkg: Package = {
      id: pkgId,
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      authorityKey: "001|01|001",
      medicinalProductId: mpId,
      description: "001 10 tablet(s)",
      quantity: { structured: false },
      regulatoryStatus: { system: SWISSMEDIC_SYSTEMS.regulatoryStatus, code: "Z" },
      identifiers: [{ system: SWISSMEDIC_SYSTEMS.package, value: "001|01|001" }],
      fieldProvenance: {},
      sourceRecords: [],
    };
    cat.packages.push(pkg);
    cat.sourceSnapshots.push(snap());
    applyRefdata(cat, articles, snap());
    expect(pkg.gtin).toBe("7680123450017");
    expect(pkg.marketingStatus?.code).toBe("inCommerce");
    expect(pkg.names).toEqual([
      { language: "de", text: "Prednison DE" },
      { language: "fr", text: "Prednisone FR" },
    ]);
    expect(pkg.marketingValidFrom).toBe("2020-01-01");
    expect(pkg.marketingValidTo).toBe("2099-12-31");
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
            retrievedAt: "1970-01-01T00:00:00.000Z",
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
      retrievedAt: "1970-01-01T00:00:00.000Z",
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
