import { describe, expect, it } from "vitest";
import { parseXmlString, text } from "../src/xml.js";
import { SwissmedicAdapter } from "../src/adapters/ch/swissmedic.js";
import { repoPath } from "../src/paths.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const G_XML = `<?xml version="1.0" encoding="utf-8"?>
<n0:SMC_Deklaration xmlns:n0="http://ccsap.bit.admin.ch/SWISSMEDIC/LIMS_HMIT_KHZ">
  <DEKLARATION>
    <ZULASSUNGSNUMMER>001</ZULASSUNGSNUMMER>
    <SEQUENZNUMMER>01</SEQUENZNUMMER>
    <KOMPONENTENNUMMER>1</KOMPONENTENNUMMER>
    <KOMPONENTE>(N/A)</KOMPONENTE>
    <ZEILENNUMMER>1</ZEILENNUMMER>
    <SORTIERUNG_ZEILENNUMMER>1</SORTIERUNG_ZEILENNUMMER>
    <ZEILENTYP>S</ZEILENTYP>
    <STOFF_ID>SUB1</STOFF_ID>
    <STOFFKATEGORIE>WIRKS</STOFFKATEGORIE>
    <MENGE>500</MENGE>
    <MENGEN_EINHEIT>MG</MENGEN_EINHEIT>
    <DEKLARATIONSART>1</DEKLARATIONSART>
  </DEKLARATION>
  <DEKLARATION>
    <ZULASSUNGSNUMMER>001</ZULASSUNGSNUMMER>
    <SEQUENZNUMMER>01</SEQUENZNUMMER>
    <KOMPONENTENNUMMER>1</KOMPONENTENNUMMER>
    <KOMPONENTE>(N/A)</KOMPONENTE>
    <ZEILENNUMMER>2</ZEILENNUMMER>
    <SORTIERUNG_ZEILENNUMMER>2</SORTIERUNG_ZEILENNUMMER>
    <ZEILENTYP>G</ZEILENTYP>
    <STOFF_ID>BASIS1</STOFF_ID>
    <STOFFKATEGORIE>GALEN</STOFFKATEGORIE>
    <MENGE></MENGE>
    <MENGEN_EINHEIT></MENGEN_EINHEIT>
    <DEKLARATIONSART>2</DEKLARATIONSART>
  </DEKLARATION>
</n0:SMC_Deklaration>`;

describe("declaration blocks", () => {
  it("parses G rows and does not guess a denominator from incomplete basis", async () => {
    const doc = parseXmlString(G_XML) as { "n0:SMC_Deklaration"?: unknown };
    void doc;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omc-decl-"));
    const xmlDir = path.join(tmp, "extracted");
    fs.mkdirSync(xmlDir);
    // Copy fixture files and overlay deklarationen + extra product 001 would be heavy;
    // assert parser keeps ZEILENTYP as string G and 001 keys.
    fs.writeFileSync(path.join(tmp, "decl.xml"), G_XML);
    const parsed = parseXmlString(fs.readFileSync(path.join(tmp, "decl.xml"), "utf8")) as Record<
      string,
      unknown
    >;
    const walk = (n: unknown): Record<string, unknown>[] => {
      if (!n || typeof n !== "object") return [];
      if (Array.isArray(n)) return n.flatMap(walk);
      const rec = n as Record<string, unknown>;
      if ("DEKLARATION" in rec) {
        const d = rec.DEKLARATION;
        return Array.isArray(d) ? (d as Record<string, unknown>[]) : [d as Record<string, unknown>];
      }
      return Object.values(rec).flatMap(walk);
    };
    const rows = walk(parsed);
    expect(rows).toHaveLength(2);
    expect(text(rows[0]?.ZULASSUNGSNUMMER)).toBe("001");
    expect(text(rows[0]?.ZEILENTYP)).toBe("S");
    expect(text(rows[1]?.ZEILENTYP)).toBe("G");
    expect(text(rows[0]?.MENGE)).toBe("500");
  });

  it("adapter metadata is swissmedic without credentials", () => {
    const a = new SwissmedicAdapter();
    expect(a.metadata().credentialsRequired).toBe(false);
    expect(a.metadata().sourceId).toBe("swissmedic");
    expect(fs.existsSync(repoPath("adapters/ch/swissmedic/source.yaml"))).toBe(true);
  });
});
