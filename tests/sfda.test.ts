import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyCatalogue } from "../src/adapters/compose.js";
import { SfdaAdapter, humanDrugListUrl } from "../src/adapters/sa/sfda.js";
import type { AdapterContext } from "../src/adapters/types.js";
import {
  SFDA_SYSTEMS,
  medicinalProductDomain,
  type Package,
  type SourceSnapshot,
} from "../src/canonical/types.js";
import { exportR4, medicationStatus } from "../src/fhir/r4.js";
import { qualityReport } from "../src/pipeline/quality.js";
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

function sfdaPackage(status: string): Package {
  return {
    id: "00000000-0000-5000-8000-000000000001",
    jurisdiction: "SA",
    identityAuthority: "sfda",
    authorityKey: "test",
    medicinalProductId: "00000000-0000-5000-8000-000000000002",
    description: "Example",
    quantity: { structured: false },
    domain: medicinalProductDomain("Human"),
    regulatoryStatus: { system: SFDA_SYSTEMS.authorizationStatus, code: status },
    identifiers: [],
    fieldProvenance: {},
    sourceRecords: [],
  };
}

describe("SFDA R4 medication status", () => {
  it("maps SFDA authorization status to Medication.status", () => {
    expect(medicationStatus(sfdaPackage("Valid"))).toBe("active");
    expect(medicationStatus(sfdaPackage("Conditional Approval"))).toBe("active");
    expect(medicationStatus(sfdaPackage("Withdrawn by MAH"))).toBe("inactive");
    expect(medicationStatus(sfdaPackage("Withdrawn by regulatory authority"))).toBe("inactive");
    expect(medicationStatus(sfdaPackage("Invalid"))).toBe("inactive");
    expect(medicationStatus(sfdaPackage("Suspended"))).toBe("inactive");
    expect(medicationStatus(sfdaPackage("unknown"))).toBeUndefined();
  });

  it("exports status on R4 Medication resources", async () => {
    const partial = await products([
      {
        registerNumber: "valid-1",
        tradeName: "Valid Product",
        scientificName: "EXAMPLE",
        strength: "10",
        strengthUnit: "mg",
        productType: "Human",
        authorizationStatus: "Valid",
      },
      {
        registerNumber: "withdrawn-1",
        tradeName: "Withdrawn Product",
        scientificName: "EXAMPLE TWO",
        strength: "10",
        strengthUnit: "mg",
        productType: "Human",
        authorizationStatus: "Withdrawn by MAH",
      },
    ]);
    const catalogue = { ...emptyCatalogue("custom-sa", "SA", "0.1.0"), ...partial };
    const r4 = exportR4(catalogue, "custom-sa-2026.04")["Medication.ndjson"]!.map((line) => JSON.parse(line) as {
      status?: string;
      extension?: { url?: string; valueCoding?: { code?: string } }[];
    });
    const valid = r4.find((med) =>
      med.extension?.some(
        (ext) => ext.url?.endsWith("/regulatory-status") && ext.valueCoding?.code === "Valid",
      ),
    );
    const withdrawn = r4.find((med) =>
      med.extension?.some(
        (ext) => ext.url?.endsWith("/regulatory-status") && ext.valueCoding?.code === "Withdrawn by MAH",
      ),
    );
    expect(valid?.status).toBe("active");
    expect(withdrawn?.status).toBe("inactive");
  });
});

describe("SFDA R4 ingredient strength", () => {
  it("exports numerator-only structured strengths with denominator 1", async () => {
    const partial = await products([
      {
        registerNumber: "600mg-1",
        tradeName: "Example",
        scientificName: "PARACETAMOL",
        strength: "600",
        strengthUnit: "mg",
        productType: "Human",
        authorizationStatus: "Valid",
      },
    ]);
    const catalogue = { ...emptyCatalogue("custom-sa", "SA", "0.1.0"), ...partial };
    const r4 = exportR4(catalogue, "custom-sa-2026.04")["Medication.ndjson"]!.map((line) => JSON.parse(line) as {
      ingredient?: {
        itemCodeableConcept?: { text?: string };
        strength?: { numerator?: { value?: number; unit?: string }; denominator?: { value?: number; unit?: string } };
      }[];
    });
    const med = r4.find((resource) =>
      resource.ingredient?.some((ingredient) => ingredient.itemCodeableConcept?.text === "PARACETAMOL"),
    );
    expect(med?.ingredient?.[0]?.strength).toEqual({
      numerator: { value: 600, unit: "mg" },
      denominator: { value: 1 },
    });
  });

  it("keeps explicit presentation ratios when denominator unit is present", async () => {
    const partial = await products([
      {
        registerNumber: "ratio-1",
        tradeName: "Example",
        scientificName: "EXAMPLE",
        strength: "4",
        strengthUnit: "mg/5 ml",
        productType: "Human",
        authorizationStatus: "Valid",
      },
    ]);
    const catalogue = { ...emptyCatalogue("custom-sa", "SA", "0.1.0"), ...partial };
    const r4 = exportR4(catalogue, "custom-sa-2026.04")["Medication.ndjson"]!.map((line) => JSON.parse(line) as {
      ingredient?: {
        strength?: { numerator?: { value?: number; unit?: string }; denominator?: { value?: number; unit?: string } };
      }[];
    });
    expect(r4[0]?.ingredient?.[0]?.strength).toEqual({
      numerator: { value: 4, unit: "mg" },
      denominator: { value: 1, unit: "5 ml" },
    });
  });
});

describe("SFDA normalize", () => {
  it("splits ingredients when names and strengths align and the unit is blank", async () => {
    const catalogue = await products([
      {
        registerNumber: "blank-unit-1",
        tradeName: "Example",
        scientificName: "ASCORBIC ACID, PARACETAMOL, PHENYLEPHRINE HYDROCHLORIDE",
        strength: "600, 40, 10",
        strengthUnit: "",
        productType: "Human",
        authorizationStatus: "Valid",
      },
    ]);
    const product = catalogue.medicinalProducts[0]!;
    expect(product.ingredients.map((ingredient) => ingredient.name)).toEqual([
      "ASCORBIC ACID",
      "PARACETAMOL",
      "PHENYLEPHRINE HYDROCHLORIDE",
    ]);
    expect(product.ingredients.map((ingredient) => ingredient.strength)).toEqual([
      expect.objectContaining({ text: "600", structured: false }),
      expect.objectContaining({ text: "40", structured: false }),
      expect.objectContaining({ text: "10", structured: false }),
    ]);
  });

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

const FORMULARY = "https://www.chi.gov.sa/en/Rules/Pages/DamanDrugFormulary.aspx";

function card(title: string, href: string): string {
  return `<div class="regulations-first-tab-card"><p class="regulations-title text-[#131826]">${title}</p><a href="${href}">Download File</a></div>`;
}

describe("SFDA formulary href", () => {
  const page = [
    card("CHI Drug\n                                    Formulary ", "/Style%20Library/IDF_Branding/files/CHI%20Drug%20Formulary%20ed59.xlsx"),
    card("CHI Active Ingredient", "/Style%20Library/IDF_Branding/files/CHI%20Active%20Ingredient.xlsx"),
    card("SFDA\n                                    Human Drug List ", "/Style%20Library/IDF_Branding/files/Human%20Drug%20List%204-2026.xlsx"),
  ].join("\n");

  it("follows the SFDA Human Drug List card and ignores the other workbooks", () => {
    expect(humanDrugListUrl(page, FORMULARY)).toBe(
      "https://www.chi.gov.sa/Style%20Library/IDF_Branding/files/Human%20Drug%20List%204-2026.xlsx",
    );
  });

  it("rejects a page with no human-drug-list card", () => {
    expect(() => humanDrugListUrl(card("CHI Drug Formulary", "/files/other.xlsx"), FORMULARY)).toThrow(/no SFDA Human Drug List/);
  });

  it("rejects a card whose link is not an xlsx on chi.gov.sa", () => {
    expect(() => humanDrugListUrl(card("SFDA Human Drug List", "https://example.com/list.xlsx"), FORMULARY)).toThrow(
      /not on chi.gov.sa/,
    );
    expect(() => humanDrugListUrl(card("SFDA Human Drug List", "/files/list.pdf"), FORMULARY)).toThrow(/not an xlsx/);
  });
});

describe("SFDA fixture workbook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads the workbook linked from the formulary page", async () => {
    const xlsx = fs.readFileSync(repoPath("fixtures/sa/sfda/drugs-list.xlsx"));
    const fileUrl = "https://www.chi.gov.sa/Style%20Library/IDF_Branding/files/Human%20Drug%20List%209-2026.xlsx";
    const html = card("SFDA Human Drug List", fileUrl);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === FORMULARY) return new Response(html, { status: 200 });
      if (url === fileUrl) return new Response(xlsx, { status: 200 });
      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SfdaAdapter();
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfda-live-"));
    const fetched = await adapter.fetch({
      cacheDir,
      secrets: {},
      releaseMonth: "2026.09",
      cutoffDate: "2026-09-30",
      archiveMonth: "202609",
      domain: "Human",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetched.snapshot.uri).toBe(fileUrl);
    expect(fetched.files[0] && fs.readFileSync(fetched.files[0]).equals(xlsx)).toBe(true);
  });

  it("maps the synthetic sheet from --input", async () => {
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

    const quality = qualityReport({ ...emptyCatalogue("custom-sa", "SA", "0.1.0"), ...catalogue });
    expect(quality.percentProductsWithAtc).toBe(50);
  });

  it("restores a leading zero when GTIN is stored as an Excel number", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("list");
    sheet.addRow(["RegisterNumber", "Trade Name", "Scientific Name", "Product type", "GTIN"]);
    sheet.addRow(["n-1", "Example", "EXAMPLE", "Human", 6281112223334]);
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfda-gtin-"));
    const inputPath = path.join(cacheDir, "drugs-list.xlsx");
    await workbook.xlsx.writeFile(inputPath);

    const adapter = new SfdaAdapter();
    const fixtureCtx: AdapterContext = {
      cacheDir,
      secrets: {},
      releaseMonth: "2026.04",
      cutoffDate: "2026-04-30",
      archiveMonth: "202604",
      domain: "Human",
    };
    const fetched = await adapter.fetch({ ...fixtureCtx, inputPath });
    const parsed = await adapter.parse(fixtureCtx, fetched);
    const catalogue = await adapter.normalize(fixtureCtx, parsed, fetched.snapshot);
    expect(catalogue.packages[0]?.gtin).toBe("06281112223334");
    expect(
      catalogue.packages[0]?.identifiers?.some(
        (id) => id.system === "https://www.gs1.org/gtin" && id.value === "06281112223334",
      ),
    ).toBe(true);
  });
});
