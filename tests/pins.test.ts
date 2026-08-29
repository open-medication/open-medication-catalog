import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoPath } from "../src/paths.js";
import { validateReleaseFhir } from "../src/pipeline/validator.js";

describe("pins and terms snapshots", () => {
  it("pins a real validator SHA-256", () => {
    const pins = JSON.parse(fs.readFileSync(repoPath("tooling/pins.json"), "utf8"));
    expect(pins.validator.version).toBe("6.9.12");
    expect(pins.validator.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(pins.validator.sha256).not.toBe("PENDING_FIRST_DOWNLOAD");
    expect(pins.sushi).toBe("3.20.1");
  });

  it("has terms snapshots for every CH source", () => {
    for (const src of ["swissmedic", "refdata", "bag"]) {
      const snap = fs.readFileSync(repoPath("adapters/ch", src, "terms.snapshot.txt"), "utf8").trim();
      expect(snap).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("fhir-validate preflight", () => {
  it("fails when the release dir has no NDJSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omc-empty-"));
    expect(() => validateReleaseFhir({ releaseDir: dir, jar: "unused.jar" })).toThrow(/No FHIR NDJSON/);
  });
});
