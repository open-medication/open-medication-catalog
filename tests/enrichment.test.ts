import { describe, expect, it } from "vitest";
import { collectArticles, applyRefdata } from "../src/adapters/ch/refdata.js";
import { parseXmlString } from "../src/xml.js";
import { emptyCatalogue } from "../src/adapters/compose.js";
import { canonicalId } from "../src/identity.js";
import { authorityKey } from "../src/branded.js";
import { SWISSMEDIC_SYSTEMS } from "../src/canonical/types.js";
import { BagAdapter } from "../src/adapters/ch/bag.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Package, SourceSnapshot } from "../src/canonical/types.js";

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
      <ARTICLE><GTIN>7680123450017</GTIN><AUTHNR>001</AUTHNR><PACKCODE>001</PACKCODE><STATUS>inCommerce</STATUS></ARTICLE>
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
