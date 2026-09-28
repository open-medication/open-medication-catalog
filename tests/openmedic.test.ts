import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyOpenMedic, extractOpenMedicZipUrl, parseOpenMedicCsv, type OpenMedicParsed } from "../src/adapters/fr/openmedic.js";
import { emptyCatalogue } from "../src/adapters/compose.js";
import { canonicalId } from "../src/identity.js";
import { authorityKey } from "../src/branded.js";
import { BDPM_SYSTEMS, medicinalProductDomain, type MedicinalProduct, type Package, type SourceSnapshot } from "../src/canonical/types.js";

function snap(): SourceSnapshot {
  return {
    id: "snap1",
    sourceId: "openmedic",
    identityAuthority: "openmedic",
    retrievedAt: "1970-01-01T00:00:00.000Z",
    sha256: "abc",
    uri: "file:fixture",
  };
}

function product(cis: string, ...packageIds: string[]): { mp: MedicinalProduct; pkgs: Package[] } {
  const mpId = canonicalId({
    jurisdiction: "FR",
    identityAuthority: "bdpm",
    entityType: "MedicinalProduct",
    authorityKey: authorityKey([cis]),
  });
  const mp: MedicinalProduct = {
    id: mpId,
    jurisdiction: "FR",
    identityAuthority: "bdpm",
    authorityKey: cis,
    names: [{ text: `Product ${cis}`, language: "fr" }],
    domain: medicinalProductDomain("Human"),
    routes: [],
    regulatoryStatus: { system: BDPM_SYSTEMS.regulatoryStatus, code: "active" },
    identifiers: [{ system: BDPM_SYSTEMS.cis, value: cis, use: "official" }],
    declarationRows: [],
    ingredients: [],
    sourceRecords: [],
  };
  const pkgs = packageIds.map((cip) => {
    const pkgId = canonicalId({
      jurisdiction: "FR",
      identityAuthority: "bdpm",
      entityType: "Package",
      authorityKey: authorityKey([cip]),
    });
    const pkg: Package = {
      id: pkgId,
      jurisdiction: "FR",
      identityAuthority: "bdpm",
      authorityKey: cip,
      medicinalProductId: mpId,
      description: cip,
      quantity: { structured: false },
      domain: medicinalProductDomain("Human"),
      regulatoryStatus: { system: BDPM_SYSTEMS.regulatoryStatus, code: "active" },
      identifiers: [{ system: BDPM_SYSTEMS.cip, value: cip, use: "official" }],
      fieldProvenance: {},
      sourceRecords: [],
    };
    return pkg;
  });
  return { mp, pkgs };
}

function parsed(atcByCip: Record<string, string>): OpenMedicParsed {
  return {
    edition: 2025,
    atcByCip: new Map(Object.entries(atcByCip)),
    rows: Object.keys(atcByCip).length,
    cipCount: Object.keys(atcByCip).length,
    unknownColumns: [],
  };
}

describe("openmedic parse", () => {
  it("streams CIP13 → ATC from the real Open Medic layout", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "om-openmedic-")), "OPEN_MEDIC_2025.CSV");
    fs.writeFileSync(
      file,
      [
        "ATC1;l_ATC1;ATC2;L_ATC2;ATC3;L_ATC3;ATC4;L_ATC4;ATC5;L_ATC5;CIP13;l_cip13;TOP_GEN;GEN_NUM;age;sexe;BEN_REG;PSP_SPE;BOITES;REM;BSE",
        "L;X;L02;X;L02B;X;L02BG;X;L02BG03;ANASTROZOLE;3400949497294;ANASTROZOLE ACCORD 1 mg;0;0;99;9;99;99;123;135,06;150,47",
        "L;X;L02;X;L02B;X;L02BG;X;L02BG03;ANASTROZOLE;3400949497294;ANASTROZOLE ACCORD 1 mg;0;0;99;9;11;99;321;34,12;37,89",
        "N;X;N02;X;N02B;X;N02BE;X;N02BE01;PARACETAMOL;not-a-cip13;DOLIPRANE;0;0;99;9;99;99;9;1,00;1,11",
        "N;X;N02;X;N02B;X;N02BE;X;;PARACETAMOL SANS ATC;3400930000091;X;0;0;99;9;99;99;9;1,00;1,11",
      ].join("\n"),
      "latin1",
    );
    const { atcByCip, rows, unknownColumns } = await parseOpenMedicCsv(file);
    expect(atcByCip.get("3400949497294")).toBe("L02BG03");
    expect(atcByCip.has("3400930000091")).toBe(false); // empty ATC is not a guess
    expect(atcByCip.size).toBe(1);
    expect(rows).toBe(4); // two matching rows, one invalid CIP13, one empty ATC
    expect(unknownColumns).toEqual([]);
  });

  it("surfaces unknown header columns instead of ignoring them", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "om-openmedic-")), "OPEN_MEDIC_2025.CSV");
    fs.writeFileSync(
      file,
      [
        "ATC1;ATC5;CIP13;NEW_COLUMN",
        "L;L02BG03;3400949497294;x",
      ].join("\n"),
      "latin1",
    );
    const { unknownColumns } = await parseOpenMedicCsv(file);
    expect(unknownColumns).toEqual(["new_column"]);
  });

  it("rejects a header without ATC5/CIP13", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "om-openmedic-")), "bad.CSV");
    fs.writeFileSync(file, "A;B;C\n1;2;3\n", "latin1");
    await expect(parseOpenMedicCsv(file)).rejects.toThrow(/ATC5\/CIP13/);
  });

  it("resolves the tokenized zip link from the download page", () => {
    const page = Buffer.from(
      '<tr><td data-label="fichier"><a href="./download_file.php?token=abc123&file=Open_MEDIC_Base_Complete/OPEN_MEDIC_2025.zip">OPEN_MEDIC_2025.zip</a></td></tr>',
      "latin1",
    );
    expect(extractOpenMedicZipUrl(page, "https://open-data-assurance-maladie.ameli.fr/medicaments/download.php?Dir_Rep=Open_MEDIC_Base_Complete&Annee=2025")).toBe(
      "https://open-data-assurance-maladie.ameli.fr/medicaments/download_file.php?token=abc123&file=Open_MEDIC_Base_Complete/OPEN_MEDIC_2025.zip",
    );
    expect(extractOpenMedicZipUrl(Buffer.from("<html></html>", "latin1"), "https://x")).toBeUndefined();
  });
});

describe("openmedic join", () => {
  it("attaches ATC when all matched presentations agree", () => {
    const cat = emptyCatalogue("fr-enriched", "FR", "0.1.0");
    const ana = product("60002283", "3400949497294", "3400949497706");
    const a313 = product("61266250", "3400930001479");
    cat.medicinalProducts.push(ana.mp, a313.mp);
    cat.packages.push(...ana.pkgs, ...a313.pkgs);
    cat.sourceSnapshots.push(snap());
    cat.mappingCoverage.push({ sourceId: "openmedic", fields: [], unknownFields: [] });
    applyOpenMedic(cat, parsed({ "3400949497294": "L02BG03", "3400949497706": "L02BG03" }), snap());
    expect(ana.mp.identifiers.some((i) => i.system === "http://www.whocc.no/atc" && i.value === "L02BG03")).toBe(true);
    expect(a313.mp.identifiers.some((i) => i.system === "http://www.whocc.no/atc")).toBe(false);
  });

  it("does not guess when presentations disagree", () => {
    const cat = emptyCatalogue("fr-enriched", "FR", "0.1.0");
    const combo = product("60009999", "3400999999991", "3400999999992");
    cat.medicinalProducts.push(combo.mp);
    cat.packages.push(...combo.pkgs);
    cat.sourceSnapshots.push(snap());
    const coverage = { sourceId: "openmedic", fields: [], unknownFields: [] };
    cat.mappingCoverage.push(coverage);
    applyOpenMedic(cat, parsed({ "3400999999991": "A10BA02", "3400999999992": "A10BB01" }), snap());
    expect(combo.mp.identifiers.some((i) => i.system === "http://www.whocc.no/atc")).toBe(false);
    expect(coverage.fields.find((f) => f.name === "atc-mismatch")?.count).toBe(1);
  });
});
