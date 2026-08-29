import { describe, expect, it } from "vitest";
import { asAuthorisationNumber, asPackageCode, asSequenceNumber, authorityKey } from "../src/branded.js";
import { canonicalId, PROJECT_NAMESPACE } from "../src/identity.js";
import { v5 as uuidv5 } from "uuid";
import { parseXmlString, text } from "../src/xml.js";

describe("string identity invariant", () => {
  it("keeps 001 as a string, not number 1", () => {
    const xml = `<ROOT><PACKUNGSCODE>001</PACKUNGSCODE><SEQUENZNUMMER>01</SEQUENZNUMMER></ROOT>`;
    const doc = parseXmlString(xml) as { ROOT: { PACKUNGSCODE: unknown; SEQUENZNUMMER: unknown } };
    expect(typeof doc.ROOT.PACKUNGSCODE).toBe("string");
    expect(doc.ROOT.PACKUNGSCODE).toBe("001");
    expect(text(doc.ROOT.PACKUNGSCODE)).toBe("001");
    expect(text(doc.ROOT.SEQUENZNUMMER)).toBe("01");
  });

  it("UUIDv5 differs for 1 vs 01 vs 001", () => {
    const a = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      entityType: "Package",
      authorityKey: authorityKey(["1", "1", "1"]),
    });
    const b = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      entityType: "Package",
      authorityKey: authorityKey(["01", "1", "1"]),
    });
    const c = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      entityType: "Package",
      authorityKey: authorityKey(["001", "1", "1"]),
    });
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(asAuthorisationNumber("001")).toBe("001");
    expect(asSequenceNumber("01")).toBe("01");
    expect(asPackageCode("001")).toBe("001");
  });

  it("identityAuthority is part of the id namespace", () => {
    const swiss = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "swissmedic",
      entityType: "MedicinalProduct",
      authorityKey: "123456|01",
    });
    const other = canonicalId({
      jurisdiction: "CH",
      identityAuthority: "other",
      entityType: "MedicinalProduct",
      authorityKey: "123456|01",
    });
    expect(swiss).not.toBe(other);
    expect(swiss).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("project namespace is UUIDv5(DNS, openmedicationcatalog.org)", () => {
    const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    expect(PROJECT_NAMESPACE).toBe(uuidv5("openmedicationcatalog.org", DNS));
  });
});
