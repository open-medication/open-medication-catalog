import { describe, expect, it } from "vitest";
import { emptyCatalogue } from "../src/adapters/compose.js";
import {
  RPL_SYSTEMS,
  WHO_ATC_SYSTEM,
  medicinalProductDomain,
  type Catalogue,
  type MedicinalProduct,
  type Package,
} from "../src/canonical/types.js";
import { exportR4 } from "../src/fhir/r4.js";
import { qualityReport } from "../src/pipeline/quality.js";

const ACTIVE_ROLE = { system: RPL_SYSTEMS.ingredientRole, code: "substancja czynna", display: "substancja czynna" };

function mp(id: string, overrides: Partial<MedicinalProduct> = {}): MedicinalProduct {
  return {
    id,
    jurisdiction: "PL",
    identityAuthority: "rpl",
    authorityKey: id,
    names: [{ text: "Example", language: "pl" }],
    domain: medicinalProductDomain("Human"),
    routes: [],
    regulatoryStatus: { system: RPL_SYSTEMS.regulatoryStatus, code: "A", display: "A" },
    identifiers: [],
    declarationRows: [],
    ingredients: [],
    sourceRecords: [],
    ...overrides,
  };
}

function pkg(id: string, mpId: string, overrides: Partial<Package> = {}): Package {
  return {
    id,
    jurisdiction: "PL",
    identityAuthority: "rpl",
    authorityKey: id,
    medicinalProductId: mpId,
    description: "Example",
    quantity: { structured: false },
    domain: medicinalProductDomain("Human"),
    regulatoryStatus: { system: RPL_SYSTEMS.regulatoryStatus, code: "A", display: "A" },
    identifiers: [],
    fieldProvenance: {},
    sourceRecords: [],
    ...overrides,
  };
}

function catalogueWith(...entries: { mp: MedicinalProduct; pkg: Package }[]): Catalogue {
  const catalogue = emptyCatalogue("pl-base", "PL", "0.1.0");
  catalogue.medicinalProducts = entries.map((e) => e.mp);
  catalogue.packages = entries.map((e) => e.pkg);
  return catalogue;
}

function medication(catalogue: Catalogue, pkgId: string): Record<string, unknown> {
  const r4 = exportR4(catalogue, "pl-base-2026.09")["Medication.ndjson"]!.map((line) => JSON.parse(line));
  const med = r4.find((resource) => resource.id === pkgId);
  expect(med).toBeDefined();
  return med!;
}

describe("R4 export pins (non-SFDA catalogue)", () => {
  it("exports a numerator-only strength with denominator value 1", () => {
    const product = mp("mp-1", {
      ingredients: [
        {
          id: "ing-1",
          declarationRowId: "row-1",
          name: "PARACETAMOL",
          role: ACTIVE_ROLE,
          strength: {
            numeratorValue: "500",
            numeratorUnit: { system: RPL_SYSTEMS.quantityUnit, code: "mg", display: "mg" },
            structured: true,
          },
        },
      ],
    });
    const pack = pkg("pkg-1", "mp-1");
    const med = medication(catalogueWith({ mp: product, pkg: pack }), "pkg-1");
    expect(med.ingredient).toEqual([
      {
        itemCodeableConcept: {
          text: "PARACETAMOL",
          coding: [ACTIVE_ROLE],
        },
        strength: {
          numerator: { value: 500, unit: "mg" },
          denominator: { value: 1 },
        },
      },
    ]);
  });

  it("omits strength for an unstructured strength and amount for an unstructured quantity", () => {
    const product = mp("mp-2", {
      ingredients: [
        {
          id: "ing-2",
          declarationRowId: "row-2",
          name: "EXAMPLE",
          role: ACTIVE_ROLE,
          strength: { text: "opis", structured: false },
        },
      ],
    });
    const pack = pkg("pkg-2", "mp-2");
    const med = medication(catalogueWith({ mp: product, pkg: pack }), "pkg-2");
    expect(med.ingredient).toEqual([
      { itemCodeableConcept: { text: "EXAMPLE", coding: [ACTIVE_ROLE] } },
    ]);
    expect(med.amount).toBeUndefined();
  });

  it("counts ATC coverage per medicinal product: group ATC, direct identifier, neither", () => {
    const withGroup = mp("mp-3", { productGroupId: "group-1" });
    const directAtc = mp("mp-4", {
      identifiers: [{ system: WHO_ATC_SYSTEM, value: "N02BE01" }],
    });
    const neither = mp("mp-5");
    const catalogue = catalogueWith(
      { mp: withGroup, pkg: pkg("pkg-3", "mp-3") },
      { mp: directAtc, pkg: pkg("pkg-4", "mp-4") },
      { mp: neither, pkg: pkg("pkg-5", "mp-5") },
    );
    catalogue.productGroups = [
      {
        id: "group-1",
        jurisdiction: "PL",
        identityAuthority: "rpl",
        authorityKey: "group-1",
        names: [{ text: "Example group", language: "pl" }],
        domain: medicinalProductDomain("Human"),
        atc: { system: WHO_ATC_SYSTEM, code: "N02BE01", display: "N02BE01" },
        regulatoryStatus: { system: RPL_SYSTEMS.regulatoryStatus, code: "A", display: "A" },
        identifiers: [],
        sourceRecords: [],
      },
    ];
    const quality = qualityReport(catalogue);
    expect(quality.percentProductsWithAtc).toBe(66.7);
  });
});