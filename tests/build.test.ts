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

    expect(result.catalogue.productGroups.every((g) => g.domain.code === "Human")).toBe(true);
    expect(result.catalogue.medicinalProducts.every((p) => p.domain.code === "Human")).toBe(true);
    expect(result.catalogue.packages.every((p) => p.domain.code === "Human")).toBe(true);
    expect(result.catalogue.productGroups.some((g) => g.authorityKey === "90001")).toBe(false);
    expect(medNdjson).toContain("http://hl7.org/fhir/medicinal-product-domain");
    expect(medNdjson).toContain('"code":"Human"');
    expect(mpd).toContain('"code":"Human"');
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

describe("ch-vet-base fixture build", () => {
  const swiss = repoPath("fixtures/ch/swissmedic/OGD_FIXTURE.zip");
  const refdata = repoPath("fixtures/ch/refdata/articles.xml");

  it("includes only TAM products and emits Veterinary domain", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "omc-vet-"));
    const result = await build({
      artifactId: "ch-vet-base",
      inputBySource: { swissmedic: swiss },
      outDir: out,
      dataMonth: "2026.08",
    });
    expect(result.official).toBe(true);
    expect(result.catalogue.productGroups.map((g) => g.authorityKey)).toEqual(["90001"]);
    expect(result.catalogue.medicinalProducts.map((p) => p.authorityKey)).toEqual(["90001|1"]);
    expect(result.catalogue.packages.map((p) => p.authorityKey)).toEqual(["90001|1|1"]);
    expect(result.catalogue.productGroups[0]?.domain).toMatchObject({
      system: "http://hl7.org/fhir/medicinal-product-domain",
      code: "Veterinary",
    });
    expect(result.catalogue.medicinalProducts.every((p) => p.domain.code === "Veterinary")).toBe(true);
    expect(result.catalogue.packages.every((p) => p.domain.code === "Veterinary")).toBe(true);

    const med = fs.readFileSync(path.join(out, "release", "fhir-r4", "Medication.ndjson"), "utf8");
    expect(med).toContain("StructureDefinition/domain");
    expect(med).toContain('"code":"Veterinary"');
    expect(med).not.toContain('"code":"Human"');

    const mpd = fs.readFileSync(path.join(out, "release", "fhir-r5", "MedicinalProductDefinition.ndjson"), "utf8");
    expect(mpd).toContain('"code":"Veterinary"');
    expect(mpd).toContain("Fixture Vet Drops");

    const sqlite = path.join(out, "release", "database", "medication.sqlite");
    const db = new Database(sqlite, { readonly: true });
    const domains = db.prepare("SELECT DISTINCT domain FROM medication_packages").all() as { domain: string }[];
    db.close();
    expect(domains).toEqual([{ domain: "Veterinary" }]);
  });

  it("joins Refdata on ch-vet-enriched and refuses BAG", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "omc-vet-enr-"));
    const result = await build({
      artifactId: "ch-vet-enriched",
      inputBySource: { swissmedic: swiss, refdata },
      outDir: out,
      dataMonth: "2026.08",
    });
    expect(result.official).toBe(true);
    const pkg = result.catalogue.packages.find((p) => p.authorityKey === "90001|1|1");
    expect(pkg?.gtin).toBe("7680900010018");
    expect(pkg?.names?.map((n) => n.language)).toEqual(["de", "fr", "it", "en"]);
    expect(pkg?.domain.code).toBe("Veterinary");

    await expect(
      build({
        artifactId: "ch-vet-enriched",
        enableBag: true,
        inputBySource: { swissmedic: swiss, refdata },
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
    expect(result.catalogue.schemaVersion).toBe("0.1.2");
    expect(result.catalogue.productGroups).toHaveLength(0);
    expect(result.catalogue.medicinalProducts).toHaveLength(3);
    expect(result.catalogue.packages.length).toBeGreaterThan(0);

    const ana = result.catalogue.medicinalProducts.find((p) => p.authorityKey === "60002283");
    expect(ana?.names[0]?.text).toMatch(/ANASTROZOLE/i);
    expect(ana?.identifiers.some((i) => i.system.includes("/fr/bdpm/cis") && i.value === "60002283")).toBe(true);
    expect(ana?.doseForm?.code).toBe("poudre et solvant pour suspension injectable à libération prolongée");
    expect(ana?.doseForm?.display).toBe("poudre et  solvant pour suspension injectable à libération prolongée");

    const pack = result.catalogue.packages.find((p) => p.authorityKey === "3400949497294");
    expect(pack?.gtin).toBe("3400949497294");
    expect(pack?.jurisdiction).toBe("FR");
    expect(result.catalogue.medicinalProducts.every((p) => p.domain.code === "Human")).toBe(true);
    expect(result.catalogue.packages.every((p) => p.domain.code === "Human")).toBe(true);

    const beclo = result.catalogue.reimbursements.find((r) => {
      const pkg = result.catalogue.packages.find((p) => p.id === r.packageId);
      return pkg?.authorityKey === "3400936963504";
    });
    expect(beclo?.rates?.map((r) => r.rate)).toEqual(["65%", "15%"]);
    expect(beclo?.rates?.[0]?.indications).toMatch(/Asthme/i);
    expect(beclo?.price?.currency).toBe("EUR");
    expect(beclo?.price?.value).toBe("12,81");
    expect(beclo?.prices).toEqual([{ value: "12,81", currency: "EUR" }]);

    const med = fs.readFileSync(path.join(out, "release", "fhir-r4", "Medication.ndjson"), "utf8");
    expect(med).toContain("https://www.gs1.org/gtin");
    expect(med).toContain("fr/bdpm/cip");
    expect(med).toContain("ANASTROZOLE");
    expect(med).toContain("12,81");
    expect(med).toContain("24,34");
    expect(med).toContain("poudre et solvant pour suspension injectable à libération prolongée");
    expect(med).not.toMatch(/"code"\s*:\s*"poudre et {2}solvant/);

    const mpd = fs.readFileSync(
      path.join(out, "release", "fhir-r5", "MedicinalProductDefinition.ndjson"),
      "utf8",
    );
    expect(mpd).toContain("MedicinalProductDefinition");
    expect(mpd).toContain("/sid/fr/bdpm/cis");
    expect(mpd).toContain("poudre et solvant pour suspension injectable à libération prolongée");

    const ppd = fs.readFileSync(
      path.join(out, "release", "fhir-r5", "PackagedProductDefinition.ndjson"),
      "utf8",
    );
    expect(ppd).toContain("StructureDefinition/reimbursement");
    expect(ppd).toContain("65%");
    expect(ppd).toContain("12,81");
    expect(ppd).toContain("24,34");

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

describe("pl-base fixture build", () => {
  it("builds SQLite and FHIR from the RPL fixture", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "omc-pl-"));
    const result = await build({
      artifactId: "pl-base",
      inputBySource: { rpl: repoPath("fixtures/pl/rpl/RPL_FIXTURE.zip") },
      outDir: out,
      dataMonth: "2026.09",
    });
    expect(result.official).toBe(true);
    expect(result.catalogue.jurisdiction).toBe("PL");
    expect(result.catalogue.productGroups).toHaveLength(0);
    expect(result.catalogue.medicinalProducts).toHaveLength(4);
    expect(result.catalogue.packages).toHaveLength(8);
    expect(result.catalogue.reimbursements).toHaveLength(0);

    const zol = result.catalogue.medicinalProducts.find((p) => p.authorityKey === "100000014");
    expect(zol?.names[0]?.text).toBe("Zoledronic acid Fresenius Kabi");
    expect(zol?.identifiers.some((i) => i.system.includes("/pl/rpl/product") && i.value === "100000014")).toBe(true);
    expect(zol?.identifiers.some((i) => i.system === "http://www.whocc.no/atc" && i.value === "M05BA08")).toBe(true);
    expect(zol?.doseForm?.display).toBe("Koncentrat do sporządzania roztworu do infuzji");
    expect(zol?.declarationRows[0]?.quantity).toBe("4");
    expect(zol?.declarationRows[0]?.quantityUnit?.display).toBe("mg");
    expect(zol?.metadata?.moc).toBe("4 mg/5 ml");

    const pack = result.catalogue.packages.find((p) => p.authorityKey === "100000014|2");
    expect(pack?.gtin).toBe("05909991023652");
    expect(pack?.jurisdiction).toBe("PL");
    expect(pack?.regulatoryStatus.display).toBe("aktywne");
    expect(pack?.metadata?.kategoriaDostepnosci).toBe("Rpz");
    expect(pack?.quantity?.unit?.system).toContain("pl-rpl-package-unit");
    expect(pack?.fieldProvenance?.description?.originalField).toBe("jednostkiOpakowania");
    expect(result.catalogue.mappingCoverage[0]?.unknownFields).toEqual([]);
    expect(
      result.catalogue.mappingCoverage[0]?.fields.find((f) =>
        f.name.endsWith("produktLeczniczy.rodzajPreparatu[veterinary]"),
      )?.count,
    ).toBe(1);
    expect(
      result.catalogue.mappingCoverage[0]?.fields.find((f) => f.name.endsWith("produktLeczniczy[incomplete]"))?.count,
    ).toBe(1);

    const noGtin = result.catalogue.packages.find((p) => p.authorityKey === "100000505|122162");
    expect(noGtin?.gtin).toBeUndefined();
    expect(noGtin?.medicinalProductId).toBe(
      result.catalogue.medicinalProducts.find((p) => p.authorityKey === "100000505")?.id,
    );
    expect(noGtin?.regulatoryStatus.display).toBe("skasowane");
    expect(result.catalogue.medicinalProducts.some((p) => p.authorityKey === "100005709")).toBe(false);

    const sharedGtin = result.catalogue.packages.filter((p) => p.gtin === "05909990998203");
    expect(sharedGtin.map((p) => p.authorityKey).sort()).toEqual(["100282886|151745", "100282886|78318"]);

    const med = fs.readFileSync(path.join(out, "release", "fhir-r4", "Medication.ndjson"), "utf8");
    expect(med).toContain("https://www.gs1.org/gtin");
    expect(med).toContain("pl/rpl/package");
    expect(med).toContain("1× fiol. 5 ml");
    expect(med).toContain("05909991023652");

    const mpd = fs.readFileSync(
      path.join(out, "release", "fhir-r5", "MedicinalProductDefinition.ndjson"),
      "utf8",
    );
    expect(mpd).toContain("MedicinalProductDefinition");
    expect(mpd).toContain("/sid/pl/rpl/product");
    expect(mpd).toContain("Edelan");

    const ppd = fs.readFileSync(
      path.join(out, "release", "fhir-r5", "PackagedProductDefinition.ndjson"),
      "utf8",
    );
    expect(ppd).toContain("packageFor");
    expect(ppd).toContain("05909991023683");

    const sqlite = path.join(out, "release", "database", "medication.sqlite");
    const hits = searchPackages(sqlite, "Edelan");
    expect(hits.length).toBeGreaterThan(0);

    const sourcesMd = fs.readFileSync(path.join(out, "release", "licensing", "SOURCES.md"), "utf8");
    expect(sourcesMd).toContain("creativecommons.org/licenses/by/4.0");
    expect(sourcesMd).toContain("commercialUse: allowed");
  });
});
