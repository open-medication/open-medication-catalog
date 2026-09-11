import { describe, expect, it } from "vitest";
import { fhirCode } from "../src/fhir/serialize.js";

describe("fhirCode", () => {
  it("collapses internal whitespace so BDPM forme labels are valid FHIR tokens", () => {
    expect(fhirCode("poudre et  solvant pour suspension injectable à libération prolongée")).toBe(
      "poudre et solvant pour suspension injectable à libération prolongée",
    );
    expect(fhirCode("  comprimé\tpelliculé\n")).toBe("comprimé pelliculé");
  });
});
