import { describe, expect, it } from "vitest";
import { canonicalNdcHeader, hipaaNdc11 } from "../src/adapters/us/ndc.js";

describe("hipaaNdc11", () => {
  it("pads 4-4-2, 5-3-2, and 5-4-1 to 5-4-2", () => {
    expect(hipaaNdc11("0002-1433-01")).toBe("00002143301");
    expect(hipaaNdc11("12345-678-90")).toBe("12345067890");
    expect(hipaaNdc11("67890-1234-1")).toBe("67890123401");
  });

  it("rejects shapes that are not a 10-digit package NDC", () => {
    expect(hipaaNdc11("0002-1433")).toBeUndefined();
    expect(hipaaNdc11("0002-14333-01")).toBeUndefined();
    expect(hipaaNdc11("0002-1433-01A")).toBeUndefined();
  });
});

describe("canonicalNdcHeader", () => {
  it("aliases definition-page strength names onto the live file headers", () => {
    expect(canonicalNdcHeader("StrengthNumber")).toBe("ACTIVE_NUMERATOR_STRENGTH");
    expect(canonicalNdcHeader("ACTIVE_NUMERATOR_STRENGTH")).toBe("ACTIVE_NUMERATOR_STRENGTH");
    expect(canonicalNdcHeader("StrengthUnit")).toBe("ACTIVE_INGRED_UNIT");
    expect(canonicalNdcHeader("PRODUCTID")).toBe("PRODUCTID");
  });
});
