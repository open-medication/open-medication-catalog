import { describe, expect, it } from "vitest";
import { emptyCatalogue } from "../src/adapters/compose.js";
import { assertValidCatalogue, validateCatalogue } from "../src/canonical/validate.js";
import { CANONICAL_SCHEMA_VERSION } from "../src/canonical/types.js";
import fs from "node:fs";
import { repoPath } from "../src/paths.js";

describe("canonical JSON Schema", () => {
  it("accepts an empty catalogue", () => {
    const cat = emptyCatalogue("ch-base", "CH", "0.1.0");
    expect(cat.schemaVersion).toBe(CANONICAL_SCHEMA_VERSION);
    expect(() => assertValidCatalogue(cat)).not.toThrow();
  });

  it("rejects unknown properties via Ajv", () => {
    const cat = emptyCatalogue("ch-base", "CH", "0.1.0") as unknown as Record<string, unknown>;
    cat.notAField = true;
    const issues = validateCatalogue(cat as never);
    expect(issues.some((i) => /additional|notAField|must NOT/.test(`${i.path} ${i.message}`))).toBe(true);
  });

  it("schema file is the committed source of truth", () => {
    const schema = JSON.parse(fs.readFileSync(repoPath("canonical/schema/catalogue.schema.json"), "utf8"));
    expect(schema.$id).toContain("canonical/0.1.1/catalogue.schema.json");
    expect(schema.properties.schemaVersion.const).toBe("0.1.1");
  });
});
