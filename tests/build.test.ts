import { describe, expect, it } from "vitest";
import { build } from "../src/pipeline/build.js";
import { repoPath } from "../src/paths.js";
import { searchPackages } from "../src/sqlite/writer.js";
import { medicationStatus } from "../src/fhir/r4.js";
import Database from "better-sqlite3";
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

describe("ch-enriched fixture build", () => {
  const swiss = repoPath("fixtures/ch/swissmedic/OGD_FIXTURE.zip");
  const refdata = repoPath("fixtures/ch/refdata/articles.xml");
  const bag = repoPath("fixtures/ch/bag/epl-paxlovid.json");

  it("maps Refdata names and dates and stays official without BAG", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "omc-enr-"));
    const result = await build({
      artifactId: "ch-enriched",
      inputBySource: { swissmedic: swiss, refdata },
      outDir: out,
      dataMonth: "2026.08",
    });
    expect(result.official).toBe(true);
    expect(result.catalogue.sourceSnapshots.map((s) => s.sourceId)).toEqual(["swissmedic", "refdata"]);
    const pkg = result.catalogue.packages.find((p) => p.authorityKey === "10029|2|2");
    expect(pkg?.gtin).toBe("7680687930017");
    expect(pkg?.names?.map((n) => n.language)).toEqual(["de", "fr", "it", "en"]);
    expect(pkg?.marketingValidFrom).toBe("2020-01-01");
    expect(pkg?.marketingStatus?.code).toBe("inCommerce");

    const manifest = JSON.parse(fs.readFileSync(path.join(out, "release", "manifest.json"), "utf8")) as {
      experimentalBag?: boolean;
    };
    expect(manifest.experimentalBag).toBeUndefined();

    const ppd = fs.readFileSync(path.join(out, "release", "fhir-r5", "PackagedProductDefinition.ndjson"), "utf8");
    expect(ppd).toContain("Emser Salz Lösung Pack DE");
    expect(ppd).toContain("http://hl7.org/fhir/StructureDefinition/translation");
    expect(ppd).toContain("Emser Salz Lösung Pack FR");
    const mpd = fs.readFileSync(path.join(out, "release", "fhir-r5", "MedicinalProductDefinition.ndjson"), "utf8");
    expect(mpd).not.toContain("Emser Salz Lösung Pack FR");

    const med = fs.readFileSync(path.join(out, "release", "fhir-r4", "Medication.ndjson"), "utf8");
    expect(med).toContain("Emser Salz Lösung Pack DE");
    expect(med).toContain("package-description");

    const sqlite = path.join(out, "release", "database", "medication.sqlite");
    const hits = searchPackages(sqlite, "Pack FR");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("injects BAG only with --enable-bag and refuses publish", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "omc-bag-"));
    await expect(
      build({
        artifactId: "ch-enriched",
        enableBag: true,
        publishOfficial: true,
        inputBySource: { swissmedic: swiss, refdata, bag },
        outDir: out,
        dataMonth: "2026.08",
      }),
    ).rejects.toThrow(/cannot be published/);

    const result = await build({
      artifactId: "ch-enriched",
      enableBag: true,
      inputBySource: { swissmedic: swiss, refdata, bag },
      outDir: out,
      dataMonth: "2026.08",
    });
    expect(result.official).toBe(false);
    expect(result.catalogue.sourceSnapshots.map((s) => s.sourceId)).toEqual(["swissmedic", "refdata", "bag"]);
    expect(result.catalogue.reimbursements.length).toBeGreaterThan(0);
    const row = result.catalogue.reimbursements[0]!;
    expect(row.dossierNumber).toBe("21529");
    expect(row.costShare).toBe(10);

    const manifest = JSON.parse(fs.readFileSync(path.join(out, "release", "manifest.json"), "utf8")) as {
      experimentalBag?: boolean;
    };
    expect(manifest.experimentalBag).toBe(true);

    const ppd = fs.readFileSync(path.join(out, "release", "fhir-r5", "PackagedProductDefinition.ndjson"), "utf8");
    expect(ppd).toContain("StructureDefinition/reimbursement");
    expect(ppd).toContain("21529");
    expect([...ppd.matchAll(/"url":"dossierNumber"/g)]).toHaveLength(1);
    const authz = fs.readFileSync(path.join(out, "release", "fhir-r5", "RegulatedAuthorization.ndjson"), "utf8");
    expect(authz).not.toContain("FOPH-21529");

    const sqlite = path.join(out, "release", "database", "medication.sqlite");
    const dbHits = searchPackages(sqlite, "7680687930017");
    expect(dbHits.length).toBeGreaterThan(0);
    const db = new Database(sqlite, { readonly: true });
    const reimb = db.prepare("SELECT * FROM reimbursement").all() as { dossier_number: string; cost_share: number }[];
    db.close();
    expect(reimb).toHaveLength(1);
    expect(reimb[0]?.dossier_number).toBe("21529");
    expect(reimb[0]?.cost_share).toBe(10);
  });

  it("refuses --enable-bag on ch-base", async () => {
    await expect(
      build({
        artifactId: "ch-base",
        enableBag: true,
        inputBySource: { swissmedic: swiss },
      }),
    ).rejects.toThrow(/ch-enriched/);
  });
});

describe("fr-base fixture build", () => {
  it("builds SQLite and FHIR from the BDPM fixture", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "omc-fr-"));
    const result = await build({
      artifactId: "fr-base",
      inputBySource: { bdpm: repoPath("fixtures/fr/bdpm/BDPM_FIXTURE.zip") },
      outDir: out,
      dataMonth: "2026.09",
    });
    expect(result.official).toBe(true);
    expect(result.catalogue.jurisdiction).toBe("FR");
    expect(result.catalogue.schemaVersion).toBe("0.1.1");
    expect(result.catalogue.productGroups).toHaveLength(0);
    expect(result.catalogue.medicinalProducts).toHaveLength(3);
    expect(result.catalogue.packages.length).toBeGreaterThan(0);

    const ana = result.catalogue.medicinalProducts.find((p) => p.authorityKey === "60002283");
    expect(ana?.names[0]?.text).toMatch(/ANASTROZOLE/i);
    expect(ana?.identifiers.some((i) => i.system.includes("/fr/bdpm/cis") && i.value === "60002283")).toBe(true);

    const pack = result.catalogue.packages.find((p) => p.authorityKey === "3400949497294");
    expect(pack?.gtin).toBe("3400949497294");
    expect(pack?.jurisdiction).toBe("FR");

    const beclo = result.catalogue.reimbursements.find((r) => {
      const pkg = result.catalogue.packages.find((p) => p.id === r.packageId);
      return pkg?.authorityKey === "3400936963504";
    });
    expect(beclo?.rates?.map((r) => r.rate)).toEqual(["65%", "15%"]);
    expect(beclo?.rates?.[0]?.indications).toMatch(/Asthme/i);
    expect(beclo?.price?.currency).toBe("EUR");

    const med = fs.readFileSync(path.join(out, "release", "fhir-r4", "Medication.ndjson"), "utf8");
    expect(med).toContain("https://www.gs1.org/gtin");
    expect(med).toContain("fr/bdpm/cip");
    expect(med).toContain("ANASTROZOLE");

    const mpd = fs.readFileSync(
      path.join(out, "release", "fhir-r5", "MedicinalProductDefinition.ndjson"),
      "utf8",
    );
    expect(mpd).toContain("MedicinalProductDefinition");
    expect(mpd).toContain("/sid/fr/bdpm/cis");

    const ppd = fs.readFileSync(
      path.join(out, "release", "fhir-r5", "PackagedProductDefinition.ndjson"),
      "utf8",
    );
    expect(ppd).toContain("StructureDefinition/reimbursement");
    expect(ppd).toContain("65%");

    const sqlite = path.join(out, "release", "database", "medication.sqlite");
    const hits = searchPackages(sqlite, "ANASTROZOLE");
    expect(hits.length).toBeGreaterThan(0);
    const db = new Database(sqlite, { readonly: true });
    const rates = db.prepare("SELECT rates_json FROM reimbursement WHERE rates_json IS NOT NULL").all() as {
      rates_json: string;
    }[];
    db.close();
    expect(rates.some((r) => r.rates_json.includes("65%"))).toBe(true);

    const sourcesMd = fs.readFileSync(path.join(out, "release", "licensing", "SOURCES.md"), "utf8");
    expect(sourcesMd).toContain("licence_bdpm.pdf");
    expect(sourcesMd).toContain("commercialUse: allowed");
  });
});
