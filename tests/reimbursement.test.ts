import { describe, expect, it } from "vitest";
import { reimbursementDetailExtension } from "../src/fhir/reimbursement.js";
import type { Reimbursement } from "../src/canonical/types.js";

function children(ext: Record<string, unknown>): Record<string, unknown>[] {
  return (ext.extension as Record<string, unknown>[]) ?? [];
}

describe("reimbursementDetailExtension", () => {
  it("emits dossierNumber once", () => {
    const row: Reimbursement = {
      packageId: "pkg",
      status: { system: "https://example.org/status", code: "listed" },
      dossierNumber: "21529",
      fieldProvenance: { sourceId: "bag", snapshotId: "s" },
    };
    const urls = children(reimbursementDetailExtension(row)).filter((c) => c.url === "dossierNumber");
    expect(urls).toHaveLength(1);
    expect(urls[0]?.valueString).toBe("21529");
  });

  it("emits nested rate extensions for BDPM taux", () => {
    const row: Reimbursement = {
      packageId: "pkg",
      status: { system: "https://example.org/status", code: "oui" },
      rates: [
        { rate: "65%", indications: "asthme" },
        { rate: "15%" },
      ],
      fieldProvenance: { sourceId: "bdpm", snapshotId: "s" },
    };
    const rates = children(reimbursementDetailExtension(row)).filter((c) => c.url === "rate");
    expect(rates).toHaveLength(2);
    const first = children(rates[0]!);
    expect(first).toEqual(
      expect.arrayContaining([
        { url: "rate", valueString: "65%" },
        { url: "indications", valueString: "asthme" },
      ]),
    );
    expect(children(rates[1]!)).toEqual([{ url: "rate", valueString: "15%" }]);
  });

  it("emits nested price from singular price when prices is empty", () => {
    const row: Reimbursement = {
      packageId: "pkg",
      status: { system: "https://example.org/status", code: "oui" },
      price: { value: "12,81", currency: "EUR" },
      fieldProvenance: { sourceId: "bdpm", snapshotId: "s" },
    };
    const prices = children(reimbursementDetailExtension(row)).filter((c) => c.url === "price");
    expect(prices).toHaveLength(1);
    expect(children(prices[0]!)).toEqual([
      { url: "value", valueString: "12,81" },
      { url: "currency", valueString: "EUR" },
    ]);
  });
});
