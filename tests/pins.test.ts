import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoPath } from "../src/paths.js";
import { listReleaseFhirNdjson, validateReleaseFhir } from "../src/pipeline/validator.js";

describe("pins and terms snapshots", () => {
  it("pins a real validator SHA-256", () => {
    const pins = JSON.parse(fs.readFileSync(repoPath("tooling/pins.json"), "utf8"));
    expect(pins.validator.version).toBe("6.9.12");
    expect(pins.validator.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(pins.validator.sha256).not.toBe("PENDING_FIRST_DOWNLOAD");
    expect(pins.sushi).toBe("3.20.1");
  });

  it("has terms snapshots for every committed source", () => {
    for (const src of ["swissmedic", "refdata", "bag"]) {
      const snap = fs.readFileSync(repoPath("adapters/ch", src, "terms.snapshot.txt"), "utf8").trim();
      expect(snap).toMatch(/^[a-f0-9]{64}$/);
    }
    const bdpm = fs.readFileSync(repoPath("adapters/fr/bdpm/terms.snapshot.txt"), "utf8").trim();
    expect(bdpm).toMatch(/^[a-f0-9]{64}$/);
    const rpl = fs.readFileSync(repoPath("adapters/pl/rpl/terms.snapshot.txt"), "utf8").trim();
    expect(rpl).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("fhir-validate preflight", () => {
  it("fails when the release dir has no NDJSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omc-empty-"));
    expect(() => validateReleaseFhir({ releaseDir: dir, jar: "unused.jar" })).toThrow(/No FHIR NDJSON/);
  });

  it("discovers every NDJSON file in both FHIR directories", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omc-fhir-list-"));
    fs.mkdirSync(path.join(dir, "fhir-r4"), { recursive: true });
    fs.mkdirSync(path.join(dir, "fhir-r5"), { recursive: true });
    fs.writeFileSync(path.join(dir, "fhir-r4", "Medication.ndjson"), "{}\n");
    fs.writeFileSync(path.join(dir, "fhir-r4", "Organization.ndjson"), "{}\n");
    fs.writeFileSync(path.join(dir, "fhir-r5", "Ingredient.ndjson"), "{}\n");
    fs.writeFileSync(path.join(dir, "fhir-r5", "MedicinalProductDefinition.ndjson"), "{}\n");
    fs.writeFileSync(path.join(dir, "fhir-r5", "Organization.ndjson"), "{}\n");
    fs.writeFileSync(path.join(dir, "fhir-r5", "PackagedProductDefinition.ndjson"), "{}\n");
    fs.writeFileSync(path.join(dir, "fhir-r5", "RegulatedAuthorization.ndjson"), "{}\n");
    fs.writeFileSync(path.join(dir, "fhir-r5", "notes.txt"), "ignored");

    const groups = listReleaseFhirNdjson(dir);
    expect(groups.map((g) => g.dirName)).toEqual(["fhir-r4", "fhir-r5"]);
    expect(groups[0]?.version).toBe("4.0.1");
    expect(groups[1]?.version).toBe("5.0.0");
    expect(groups[0]?.ndjsonPaths.map((p) => path.basename(p))).toEqual([
      "Medication.ndjson",
      "Organization.ndjson",
    ]);
    expect(groups[1]?.ndjsonPaths.map((p) => path.basename(p))).toEqual([
      "Ingredient.ndjson",
      "MedicinalProductDefinition.ndjson",
      "Organization.ndjson",
      "PackagedProductDefinition.ndjson",
      "RegulatedAuthorization.ndjson",
    ]);
  });
});
