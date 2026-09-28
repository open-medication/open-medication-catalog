import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SfdaAdapter } from "../src/adapters/sa/sfda.js";
import type { AdapterContext } from "../src/adapters/types.js";
import type { SourceSnapshot } from "../src/canonical/types.js";
import type { SfdaParsed } from "../src/adapters/sa/sfda-xlsx.js";
import { repoPath } from "../src/paths.js";

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
    const health = catalogue.medicinalProducts.find((product) => product.authorityKey === "2-5115-18");
    expect(health?.metadata?.drugType).toBe("Health");
    expect(health?.regulatoryStatus).toEqual({
      system: "https://fhir.openmedicationcatalog.org/CodeSystem/sa-sfda-authorization-status",
      code: "Withdrawn by MAH",
      display: "Withdrawn by MAH",
    });
  });

  it("keeps a comma inside parentheses in one substance name", async () => {
    const catalogue = await products([
      {
        registerNumber: "vax-1",
        tradeName: "Example Vaccine",
        scientificName: "MUMPS VIRUS (JERYL LYNN, STRAIN RIT 4385) LIVE ATTENUATED",
        strength: "25119",
        strengthUnit: "CCID50",
        productType: "Human",
        authorizationStatus: "Valid",
      },
    ]);
    expect(catalogue.substances.map((substance) => substance.name)).toEqual([
      "MUMPS VIRUS (JERYL LYNN, STRAIN RIT 4385) LIVE ATTENUATED",
    ]);
    expect(catalogue.medicinalProducts[0]!.ingredients[0]!.strength).toEqual(
      expect.objectContaining({ numeratorValue: "25119", structured: true }),
    );
  });

  it("leaves a thousands separator and a range as source text", async () => {
    const catalogue = await products([
      {
        registerNumber: "iu-1",
        tradeName: "Example IU",
        scientificName: "EXAMPLE PENICILLIN",
        strength: "1,000,000",
        strengthUnit: "IU",
        productType: "Human",
        authorizationStatus: "Valid",
      },
      {
        registerNumber: "range-1",
        tradeName: "Example Range",
        scientificName: "EXAMPLE SALT",
        strength: "9.0 - 14.0",
        strengthUnit: "g",
        productType: "Human",
        authorizationStatus: "Valid",
      },
    ]);
    for (const product of catalogue.medicinalProducts) {
      expect(product.ingredients).toHaveLength(1);
      expect(product.ingredients[0]!.strength.structured).toBe(false);
    }
    expect(catalogue.substances.map((substance) => substance.authorityKey).sort()).toEqual([
      "EXAMPLE PENICILLIN",
      "EXAMPLE SALT",
    ]);
  });

  it("keeps NA, prose, and Q-prefixed ATC codes out of the WHO identifier", async () => {
    const catalogue = await products([
      {
        registerNumber: "atc-1",
        tradeName: "Example ATC",
        scientificName: "EXAMPLE",
        strength: "10",
        strengthUnit: "mg",
        productType: "Human",
        atcCode1: "N02BE01",
        atcCode2: "QA10BA02",
        authorizationStatus: "Valid",
      },
      {
        registerNumber: "atc-2",
        tradeName: "Example NA",
        scientificName: "EXAMPLE TWO",
        strength: "10",
        strengthUnit: "mg",
        productType: "Human",
        atcCode1: "NA",
        atcCode2: "L01-ANTINEOPLASTIC AGENTS",
        authorizationStatus: "Valid",
      },
    ]);
    const coded = catalogue.medicinalProducts.find((product) => product.authorityKey === "atc-1");
    expect(coded?.identifiers?.filter((id) => id.system === "http://www.whocc.no/atc").map((id) => id.value)).toEqual([
      "N02BE01",
    ]);
    expect(coded?.metadata?.atcCode2).toBe("QA10BA02");
    const prose = catalogue.medicinalProducts.find((product) => product.authorityKey === "atc-2");
    expect(prose?.identifiers?.some((id) => id.system === "http://www.whocc.no/atc")).toBe(false);
    expect(prose?.metadata?.atcCode1).toBe("NA");
  });

  it("rejects an Arabic coded token that has no English map", async () => {
    await expect(
      products([
        {
          registerNumber: "ar-1",
          tradeName: "Example",
          scientificName: "EXAMPLE",
          productType: "Human",
          doseForm: "أقراص",
          authorizationStatus: "Valid",
        },
      ]),
    ).rejects.toThrow(/Arabic/);
  });

  it("uses a distinct package key when a register number repeats", async () => {
    const catalogue = await products([
      {
        registerNumber: "same",
        tradeName: "Example",
        scientificName: "EXAMPLE",
        productType: "Human",
        packageType: "Blister",
        packageSize: "2",
        authorizationStatus: "Valid",
        marketingStatus: "Marketed",
      },
      {
        registerNumber: "same",
        tradeName: "Example",
        scientificName: "EXAMPLE",
        productType: "Human",
        packageType: "Bottle",
        packageSize: "1",
        authorizationStatus: "Valid",
        marketingStatus: "Not Marketed",
      },
    ]);
    expect(catalogue.productGroups).toEqual([]);
    expect(catalogue.medicinalProducts).toHaveLength(1);
    expect(catalogue.packages.map((pack) => pack.authorityKey).sort()).toEqual(["same", "same|Bottle|1"]);
    expect(catalogue.packages.find((pack) => pack.authorityKey === "same|Bottle|1")?.marketingStatus?.code).toBe(
      "Not Marketed",
    );
  });
});

describe("SFDA fixture workbook", () => {
  it("requires --input and maps the synthetic sheet", async () => {
    const adapter = new SfdaAdapter();
    expect(adapter.metadata().commercialUse).toBe("review-required");
    expect(adapter.metadata().redistribution).toBe("review-required");
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfda-"));
    const fixtureCtx: AdapterContext = {
      cacheDir,
      secrets: {},
      releaseMonth: "2026.04",
      cutoffDate: "2026-04-30",
      archiveMonth: "202604",
      domain: "Human",
    };
    await expect(adapter.fetch(fixtureCtx)).rejects.toThrow(/--input/);

    const fetched = await adapter.fetch({
      ...fixtureCtx,
      inputPath: repoPath("fixtures/sa/sfda/drugs-list.xlsx"),
    });
    await adapter.validateSource(fixtureCtx, fetched);
    const parsed = await adapter.parse(fixtureCtx, fetched);
    expect(parsed.coverage.unknownFields).toEqual([]);
    expect(parsed.originalHeaders.tradeName).toBe("Trade Name");
    expect(parsed.originalHeaders.secondAgent).toBe("Secosnd Agent");
    expect(parsed.rows).toHaveLength(5);

    const catalogue = await adapter.normalize(fixtureCtx, parsed, fetched.snapshot);
    expect(catalogue.productGroups).toEqual([]);
    expect(catalogue.medicinalProducts.map((product) => product.authorityKey).sort()).toEqual([
      "10-1",
      "10-2",
      "10-3",
      "10-4",
    ]);
    expect(fetched.snapshot.termsChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(fetched.snapshot.termsReviewedAt).toBe("2026-09-28");

    const cold = catalogue.medicinalProducts.find((product) => product.authorityKey === "10-1")!;
    expect(cold.ingredients.map((ingredient) => ingredient.strength.numeratorValue)).toEqual(["600", "40", "10"]);
    expect(cold.identifiers?.some((id) => id.value === "N02BE01")).toBe(false);
    expect(cold.identifiers?.some((id) => id.system === "http://www.whocc.no/atc" && id.value === "N02BE51")).toBe(true);
    const coldPack = catalogue.packages.find((pack) => pack.authorityKey === "10-1")!;
    expect(coldPack.gtin).toBe("06281112223334");
    expect(coldPack.identifiers?.some((id) => id.system === "https://www.gs1.org/gtin" && id.value === "06281112223334")).toBe(
      true,
    );
    expect(coldPack.metadata?.priceCurrency).toBe("SAR");
    expect(coldPack.metadata?.pricingDate).toBe("1447-01-01");
    expect(coldPack.metadata?.storageConditionsArabic).toBe("يحفظ تحت ٢٥");
    expect(coldPack.metadata?.secondManufacturerCountry).toBe("436");
    expect(coldPack.quantity).toEqual({ value: "2", structured: true });
    expect(coldPack.packUnits?.[0]?.capacityValue).toBe("20");
    expect(coldPack.fieldProvenance?.description?.originalField).toBe("Trade Name");
    expect(coldPack.marketingStatus?.code).toBe("Marketed");
    expect(catalogue.organizations.filter((org) => org.role === "supplier").map((org) => org.name).sort()).toEqual([
      "Main Co",
      "Only Agent",
      "Second Co",
      "Third Co",
    ]);
    expect(catalogue.organizations.filter((org) => org.role === "marketing-authorisation-holder").map((org) => org.name).sort()).toEqual([
      "Example Holder",
      "Other Holder",
    ]);
    expect(catalogue.organizations.some((org) => org.name === "Only Agent" && org.role === "marketing-authorisation-holder")).toBe(
      false,
    );

    const strain = catalogue.medicinalProducts.find((product) => product.authorityKey === "10-2")!;
    expect(strain.ingredients).toHaveLength(1);
    expect(strain.ingredients[0]!.name).toContain("JERYL LYNN, STRAIN");
    expect(strain.identifiers?.some((id) => id.value === "QA10BA02")).toBe(false);
    expect(strain.metadata?.atcCode2).toBe("QA10BA02");
    expect(catalogue.packages.find((pack) => pack.authorityKey === "10-2")?.marketingStatus?.code).toBe("Not Marketed");

    const iu = catalogue.medicinalProducts.find((product) => product.authorityKey === "10-3")!;
    expect(iu.ingredients).toHaveLength(1);
    expect(iu.ingredients[0]!.strength.structured).toBe(false);
    expect(iu.identifiers?.some((id) => id.system === "http://www.whocc.no/atc")).toBe(false);
    expect(iu.metadata?.atcCode1).toBe("NA");
    expect(catalogue.packages.find((pack) => pack.authorityKey === "10-3")?.gtin).toBeUndefined();

    const blank = catalogue.medicinalProducts.find((product) => product.authorityKey === "10-4")!;
    expect(blank.metadata?.productType).toBeUndefined();
    expect(blank.domain?.code).toBe("Human");
  });
});
