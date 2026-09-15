import { describe, expect, it } from "vitest";
import { emptyCatalogue } from "../src/adapters/compose.js";
import type { MedicinalProduct } from "../src/canonical/types.js";
import { exportR5 } from "../src/fhir/r5.js";

function productWithIngredients(
  ingredients: MedicinalProduct["ingredients"],
): MedicinalProduct {
  return {
    id: "mp-1",
    jurisdiction: "PL",
    identityAuthority: "rpl",
    authorityKey: "1",
    names: [{ text: "Example" }],
    routes: [],
    regulatoryStatus: { system: "https://example.org/status", code: "aktywne" },
    identifiers: [],
    declarationRows: [],
    ingredients,
    sourceRecords: [],
  };
}

function parseNdjson(body: string): Record<string, unknown>[] {
  return body
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("R5 Ingredient strength", () => {
  it("emits textPresentation instead of the R4-only text element", () => {
    const catalogue = emptyCatalogue("pl-base", "PL", "0.1.0");
    catalogue.medicinalProducts.push(
      productWithIngredients([
        {
          id: "ing-text",
          declarationRowId: "row-1",
          name: "Acidum zoledronicum",
          role: { system: "https://example.org/role", code: "substancja czynna" },
          strength: { text: "Acidum zoledronicum 4 mg / 5 ml", structured: false },
        },
        {
          id: "ing-ratio",
          declarationRowId: "row-2",
          name: "Paliperidonum",
          role: { system: "https://example.org/role", code: "WIRKS" },
          strength: {
            structured: true,
            numeratorValue: "3",
            numeratorUnit: { system: "https://example.org/u", code: "mg" },
            denominatorValue: "1",
            denominatorUnit: { system: "https://example.org/u", code: "tablet" },
            text: "3 mg / 1 tablet",
          },
        },
      ]),
    );

    const rows = parseNdjson(exportR5(catalogue, "2026.09")["Ingredient.ndjson"] ?? "");
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      const substance = row.substance as {
        strength?: { text?: unknown; textPresentation?: string; presentationRatio?: unknown }[];
      };
      const strength = substance.strength?.[0];
      expect(strength).toBeDefined();
      expect(strength).not.toHaveProperty("text");
      expect(strength).not.toHaveProperty("textConcentration");
    }

    const textOnly = rows.find((r) => r.id === "ing-text")?.substance as {
      strength?: { textPresentation?: string; presentationRatio?: unknown }[];
    };
    expect(textOnly.strength?.[0]).toEqual({
      textPresentation: "Acidum zoledronicum 4 mg / 5 ml",
    });

    const structured = rows.find((r) => r.id === "ing-ratio")?.substance as {
      strength?: {
        textPresentation?: string;
        presentationRatio?: { numerator: { value: number; unit?: string }; denominator: { value: number; unit?: string } };
      }[];
    };
    expect(structured.strength?.[0]?.textPresentation).toBe("3 mg / 1 tablet");
    expect(structured.strength?.[0]?.presentationRatio).toEqual({
      numerator: { value: 3, unit: "mg" },
      denominator: { value: 1, unit: "tablet" },
    });
  });
});
