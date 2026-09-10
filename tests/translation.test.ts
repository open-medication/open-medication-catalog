import { describe, expect, it } from "vitest";
import { primaryLocalizedName, translationExtensions } from "../src/fhir/translation.js";

describe("FHIR translation helper", () => {
  it("picks de then fr/it/en as the primary name", () => {
    expect(
      primaryLocalizedName([
        { language: "fr", text: "FR" },
        { language: "de", text: "DE" },
      ])?.text,
    ).toBe("DE");
    expect(primaryLocalizedName([{ language: "en", text: "EN" }])?.text).toBe("EN");
  });

  it("emits HL7 translation extensions for non-primary languages", () => {
    const ext = translationExtensions(
      [
        { language: "de", text: "DE" },
        { language: "fr", text: "FR" },
        { language: "de", text: "DE" },
      ],
      "DE",
    );
    expect(ext).toHaveLength(1);
    expect(ext?.[0]).toMatchObject({
      url: "http://hl7.org/fhir/StructureDefinition/translation",
    });
  });
});
