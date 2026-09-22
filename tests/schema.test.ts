import { describe, expect, it } from "vitest";
import { emptyCatalogue, mergePartials } from "../src/adapters/compose.js";
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

  it("merges more rows than a single push spread can take", () => {
    const cat = emptyCatalogue("us-base", "US", "0.1.0");
    const count = 150_000;
    const medicinalProducts = Array.from({ length: count }, (_, i) => ({ id: String(i) }));
    mergePartials(cat, {
      productGroups: [],
      medicinalProducts: medicinalProducts as never,
      packages: [],
      organizations: [],
      authorizations: [],
      substances: [],
      reimbursements: [],
      sourceSnapshots: [],
      mappingCoverage: [],
    });
    expect(cat.medicinalProducts).toHaveLength(count);
    expect(cat.medicinalProducts[0]?.id).toBe("0");
    expect(cat.medicinalProducts[count - 1]?.id).toBe(String(count - 1));
  });

  it("schema file is the committed source of truth", () => {
    const schema = JSON.parse(fs.readFileSync(repoPath("canonical/schema/catalogue.schema.json"), "utf8"));
    expect(schema.$id).toContain("canonical/0.1.2/catalogue.schema.json");
    expect(schema.properties.schemaVersion.const).toBe("0.1.2");
  });
});
