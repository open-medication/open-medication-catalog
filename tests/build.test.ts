import { describe, expect, it } from "vitest";
import { build } from "../src/pipeline/build.js";
import { repoPath } from "../src/paths.js";
import { searchPackages } from "../src/sqlite/writer.js";
import { medicationStatus } from "../src/fhir/r4.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("ch-base fixture build", () => {
  it("builds SQLite and FHIR from the Swissmedic fixture", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "omc-build-"));
    const result = await build({
      artifactId: "ch-base",
      inputBySource: { swissmedic: repoPath("fixtures/ch/swissmedic/OGD_FIXTURE.zip") },
      outDir: out,
      dataMonth: "2026.08",
    });
    expect(result.official).toBe(true);
    expect(result.catalogue.packages.length).toBeGreaterThan(0);
    expect(result.catalogue.medicinalProducts.length).toBeGreaterThan(0);
    expect(result.catalogue.productGroups.length).toBeGreaterThan(0);
    expect(fs.existsSync(result.zipPath)).toBe(true);

    const sqlite = path.join(out, "release", "database", "medication.sqlite");
    const hits = searchPackages(sqlite, "Emser");
    expect(hits.length).toBeGreaterThan(0);

    const medNdjson = fs.readFileSync(path.join(out, "release", "fhir-r4", "Medication.ndjson"), "utf8");
    expect(medNdjson).toContain("jurisdiction");
    expect(medNdjson).toContain("identity-authority");
    expect(medNdjson).toContain("omc-release");
    expect(medNdjson).toContain("swissmedic/package");

    const mpd = fs.readFileSync(
      path.join(out, "release", "fhir-r5", "MedicinalProductDefinition.ndjson"),
      "utf8",
    );
    expect(mpd).toContain("MedicinalProductDefinition");
    const ppd = fs.readFileSync(
      path.join(out, "release", "fhir-r5", "PackagedProductDefinition.ndjson"),
      "utf8",
    );
    expect(ppd).toContain("packageFor");

    const authz = fs.readFileSync(
      path.join(out, "release", "fhir-r5", "RegulatedAuthorization.ndjson"),
      "utf8",
    );
    const authCount = authz.trim().split("\n").filter(Boolean).length;
    expect(authCount).toBe(result.catalogue.productGroups.length);

    for (const pkg of result.catalogue.packages) {
      expect(typeof pkg.authorityKey).toBe("string");
      const parts = pkg.authorityKey.split("|");
      expect(parts).toHaveLength(3);
    }

    const revoked = result.catalogue.packages.find((p) => p.regulatoryStatus.code === "D");
    if (revoked) expect(medicationStatus(revoked)).toBe("inactive");

    const sourcesMd = fs.readFileSync(path.join(out, "release", "licensing", "SOURCES.md"), "utf8");
    const licenceReadme = fs.readFileSync(path.join(out, "release", "licensing", "README.md"), "utf8");
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "release", "manifest.json"), "utf8")) as {
      sources: { id: string; licensing?: { termsUrl: string; commercialUse: string; checksum?: string } }[];
    };
    expect(licenceReadme).toMatch(/not liable/i);
    expect(sourcesMd).toContain("https://opendata.swiss/en/terms-of-use#terms_open");
    expect(sourcesMd).toContain("commercialUse: allowed");
    const swissLic = manifest.sources.find((s) => s.id === "swissmedic")?.licensing;
    expect(swissLic?.termsUrl).toBe("https://opendata.swiss/en/terms-of-use#terms_open");
    expect(swissLic?.commercialUse).toBe("allowed");
    expect(swissLic?.checksum).toMatch(/^[a-f0-9]{64}$/);
    const snap = result.catalogue.sourceSnapshots.find((s) => s.sourceId === "swissmedic");
    expect(snap?.termsChecksum).toBe(swissLic?.checksum);
    expect(snap?.termsReviewedAt).toBeTruthy();
  });

  it("refuses to treat --source builds as official artifact ids", async () => {
    await expect(
      build({
        artifactId: "ch-base",
        sources: ["swissmedic"],
        publishOfficial: true,
        inputBySource: { swissmedic: repoPath("fixtures/ch/swissmedic/OGD_FIXTURE.zip") },
      }),
    ).rejects.toThrow(/cannot be published/);
  });
});
