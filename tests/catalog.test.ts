import { describe, expect, it } from "vitest";
import { parseFhirDecimal, jsonLine } from "../src/fhir/serialize.js";
import { catalogFromReleaseTags } from "../src/pipeline/packager.js";
import { swissmedicArchiveCandidates } from "../src/adapters/ch/swissmedic.js";

describe("parseFhirDecimal", () => {
  it("accepts Swissmedic comma decimals", () => {
    expect(parseFhirDecimal("1,5")).toBe(1.5);
    expect(parseFhirDecimal("10")).toBe(10);
    expect(parseFhirDecimal("0.25")).toBe(0.25);
  });

  it("does not emit JSON null for comma decimals", () => {
    expect(Number("1,5")).toBeNaN();
    expect(jsonLine({ value: parseFhirDecimal("1,5") })).toBe('{"value":1.5}\n');
  });

  it("returns undefined for invalid input", () => {
    expect(parseFhirDecimal("1,5,0")).toBeUndefined();
    expect(parseFhirDecimal("")).toBeUndefined();
  });
});

describe("catalogFromReleaseTags", () => {
  it("keeps the latest month for each official artifact", () => {
    const doc = catalogFromReleaseTags([
      "ch-base-2026.08",
      "ch-enriched-2026.08",
      "ch-base-2026.09",
      "fr-base-2026.09",
      "v1.0.0",
    ]);
    expect(doc.artifacts["ch-base"]?.latest).toBe("2026.09");
    expect(doc.artifacts["ch-base"]?.tag).toBe("ch-base-2026.09");
    expect(doc.artifacts["ch-base"]?.zip).toBe(
      "https://github.com/open-medication/open-medication-catalog/releases/download/ch-base-2026.09/ch-base-2026.09.zip",
    );
    expect(doc.artifacts["ch-enriched"]?.latest).toBe("2026.08");
    expect(doc.artifacts["ch-enriched"]?.tag).toBe("ch-enriched-2026.08");
    expect(doc.artifacts["fr-base"]?.latest).toBe("2026.09");
    expect(doc.artifacts["fr-base"]?.tag).toBe("fr-base-2026.09");
  });
});

describe("swissmedic archive URLs", () => {
  it("tries lowercase .zip before .ZIP", () => {
    const [lower, upper] = swissmedicArchiveCandidates("202607");
    expect(lower?.name).toBe("OGD_202607.zip");
    expect(upper?.name).toBe("OGD_202607.ZIP");
    expect(lower?.url).toContain("/Archiv/OGD_202607.zip");
  });
});
