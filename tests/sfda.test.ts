import { describe, expect, it } from "vitest";
import { SfdaAdapter } from "../src/adapters/sa/sfda.js";
import type { AdapterContext } from "../src/adapters/types.js";
import type { SourceSnapshot } from "../src/canonical/types.js";
import type { SfdaParsed } from "../src/adapters/sa/sfda-xlsx.js";

const ctx = { cutoffDate: "2026-04-01" } as AdapterContext;
const snapshot: SourceSnapshot = {
  id: "snap",
  sourceId: "sfda",
  identityAuthority: "sfda",
  retrievedAt: "1970-01-01T00:00:00.000Z",
  sha256: "abc",
  uri: "file:fixture",
};

function parsed(rows: Record<string, string>[]): SfdaParsed {
  return { rows, originalHeaders: {}, coverage: { sourceId: "sfda", fields: [], unknownFields: [] } };
}

async function products(rows: Record<string, string>[]) {
  const catalogue = await new SfdaAdapter().normalize(ctx, parsed(rows), snapshot);
  return catalogue;
}

describe("SFDA normalize", () => {
  it("applies one strength unit to every ingredient", async () => {
    const catalogue = await products([
      {
        registerNumber: "5-824-11",
        tradeName: "Example",
        scientificName: "ASCORBIC ACID, PARACETAMOL, PHENYLEPHRINE HYDROCHLORIDE",
        strength: "600, 40, 10",
        strengthUnit: "mg",
        productType: "Human",
        drugType: "Generic",
        authorizationStatus: "Valid",
      },
    ]);
    const product = catalogue.medicinalProducts[0]!;
    expect(product.ingredients.map((ingredient) => ingredient.strength)).toEqual([
      expect.objectContaining({ numeratorValue: "600", structured: true, text: "600 mg" }),
      expect.objectContaining({ numeratorValue: "40", structured: true, text: "40 mg" }),
      expect.objectContaining({ numeratorValue: "10", structured: true, text: "10 mg" }),
    ]);
  });

  it("keeps a shared strength as source text when several names share one number", async () => {
    const catalogue = await products([
      {
        registerNumber: "2511211368",
        tradeName: "Example",
        scientificName: "MENTHOL, XYLOMETAZOLINE HYDROCHLORIDE",
        strength: "0.1",
        strengthUnit: "%",
        productType: "Human",
        authorizationStatus: "Valid",
      },
    ]);
    const strengths = catalogue.medicinalProducts[0]!.ingredients.map((ingredient) => ingredient.strength);
    expect(strengths.every((strength) => strength.structured === false)).toBe(true);
  });

  it("keeps blank product type and Health drug type", async () => {
    const catalogue = await products([
      {
        registerNumber: "1004233515",
        tradeName: "Paxlovid",
        scientificName: "RITONAVIR",
        strength: "100",
        strengthUnit: "mg",
        productType: "",
        drugType: "NCE",
        authorizationStatus: "Valid",
        marketingCompany: "Pfizer",
        marketingCompanyId: "158",
      },
      {
        registerNumber: "2-5115-18",
        tradeName: "BETADINE SOOTHING RELIEF",
        scientificName: "ECTOINE",
        productType: "Human",
        drugType: "Health",
        authorizationStatus: "Withdrawn by MAH",
      },
      {
        registerNumber: "vet-1",
        tradeName: "Animal",
        scientificName: "X",
        productType: "Veterinary",
        authorizationStatus: "Valid",
      },
    ]);
    expect(catalogue.medicinalProducts.map((product) => product.authorityKey).sort()).toEqual(["1004233515", "2-5115-18"]);
    const holder = catalogue.organizations.find((org) => org.role === "marketing-authorisation-holder");
    expect(holder?.identifiers).toEqual([{ system: "https://fhir.openmedicationcatalog.org/sid/sa/sfda/organization", value: "Pfizer" }]);
    const paxlovid = catalogue.medicinalProducts.find((product) => product.authorityKey === "1004233515");
    expect(paxlovid?.metadata?.marketingCompanyId).toBe("158");
    expect(paxlovid?.metadata?.productType).toBeUndefined();
  });
});
