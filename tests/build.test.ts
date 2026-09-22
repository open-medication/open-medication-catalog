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
    expect(result.catalogue.packages).toHaveLength(9);
    expect(result.catalogue.reimbursements).toHaveLength(0);

    const zol = result.catalogue.medicinalProducts.find((p) => p.authorityKey === "100000014");
    expect(zol?.names[0]?.text).toBe("Zoledronic acid Fresenius Kabi");
    expect(zol?.domain).toMatchObject({
      system: "http://hl7.org/fhir/medicinal-product-domain",
      code: "Human",
    });
    expect(zol?.identifiers.some((i) => i.system.includes("/pl/rpl/product") && i.value === "100000014")).toBe(true);
    expect(zol?.identifiers.some((i) => i.system === "http://www.whocc.no/atc" && i.value === "M05BA08")).toBe(true);
    expect(zol?.doseForm?.display).toBe("Koncentrat do sporządzania roztworu do infuzji");
    expect(zol?.declarationRows[0]?.quantity).toBe("4");
    expect(zol?.declarationRows[0]?.quantityUnit?.display).toBe("mg");
    expect(zol?.metadata?.moc).toBe("4 mg/5 ml");
    expect(zol?.regulatoryStatus.display).toBe("aktywne");
    expect(zol?.metadata?.waznoscPozwolenia).toBe("Bezterminowe");
    expect(result.catalogue.authorizations.find((a) => a.authorityKey === "20708")?.status.display).toBe("aktywne");

    const pack = result.catalogue.packages.find((p) => p.authorityKey === "100000014|2");
    expect(pack?.gtin).toBe("05909991023652");
    expect(pack?.jurisdiction).toBe("PL");
    expect(pack?.domain.code).toBe("Human");
    expect(pack?.regulatoryStatus.display).toBe("aktywne");
    expect(pack?.metadata?.kategoriaDostepnosci).toBe("Rpz");
    expect(pack?.description).toBe("1× fiol. 5 ml");
    expect(pack?.quantity).toEqual({
      value: "5",
      unit: { system: expect.stringContaining("pl-rpl-package-unit"), code: "ml", display: "ml" },
      structured: true,
    });
    expect(pack?.packageType?.display).toBe("fiol.");
    expect(pack?.packUnits).toEqual([
      {
        count: "1",
        kind: { system: expect.stringContaining("pl-rpl-package-unit"), code: "fiol.", display: "fiol." },
        capacityValue: "5",
        capacityUnit: { system: expect.stringContaining("pl-rpl-package-unit"), code: "ml", display: "ml" },
      },
    ]);
    const fourVials = result.catalogue.packages.find((p) => p.authorityKey === "100000014|3");
    expect(fourVials?.description).toBe("4× fiol. 5 ml");
    expect(fourVials?.quantity).toEqual({
      value: "4",
      unit: { system: expect.stringContaining("pl-rpl-package-unit"), code: "fiol.", display: "fiol." },
      structured: true,
    });
    expect(fourVials?.packUnits?.[0]?.capacityValue).toBe("5");
    const tenVials = result.catalogue.packages.find((p) => p.authorityKey === "100000014|4");
    expect(tenVials?.description).toBe("10× fiol. 5 ml");
    expect(tenVials?.quantity.value).toBe("10");
    expect(tenVials?.quantity.unit?.display).toBe("fiol.");
    expect(tenVials?.quantity.structured).toBe(true);
    const tablets = result.catalogue.packages.find((p) => p.authorityKey === "100282886|78318");
    expect(tablets?.quantity).toEqual({
      value: "100",
      unit: { system: expect.stringContaining("pl-rpl-package-unit"), code: "tabl.", display: "tabl." },
      structured: true,
    });
    const kit = result.catalogue.packages.find((p) => p.authorityKey === "100000505|122163");
    expect(kit?.description).toBe("1× amp.-strzyk. 50 mg; 2× igły");
    expect(kit?.quantity).toEqual({ structured: false });
    expect(kit?.packUnits).toHaveLength(2);
    expect(pack?.fieldProvenance?.description?.originalField).toBe("jednostkiOpakowania");
    expect(result.catalogue.mappingCoverage[0]?.unknownFields).toEqual([]);
    expect(
      result.catalogue.mappingCoverage[0]?.fields.find((f) => f.name.endsWith("produktLeczniczy[incomplete]"))?.count,
    ).toBe(1);
    expect(
      result.catalogue.mappingCoverage[0]?.fields.find((f) => f.name.endsWith("produktLeczniczy[unknown-domain]"))
        ?.count,
    ).toBe(1);
    expect(result.catalogue.medicinalProducts.some((p) => p.authorityKey === "100009999")).toBe(false);
    expect(
      result.catalogue.mappingCoverage[0]?.fields.some((f) =>
        f.name.endsWith("produktLeczniczy.rodzajPreparatu[veterinary]"),
      ),
    ).toBe(false);

    const noGtin = result.catalogue.packages.find((p) => p.authorityKey === "100000505|122162");
    expect(noGtin?.gtin).toBeUndefined();
    expect(noGtin?.medicinalProductId).toBe(
      result.catalogue.medicinalProducts.find((p) => p.authorityKey === "100000505")?.id,
    );
    expect(noGtin?.regulatoryStatus.display).toBe("skasowane");
    const listed = result.catalogue.medicinalProducts.find((p) => p.authorityKey === "100000505");
    expect(listed?.regulatoryStatus.display).toBe("aktywne");
    expect(listed?.metadata?.waznoscPozwolenia).toBeUndefined();
    expect(result.catalogue.authorizations.find((a) => a.authorityKey === "100000505")?.status.display).toBe("aktywne");
    expect(result.catalogue.medicinalProducts.every((p) => p.regulatoryStatus.display === "aktywne")).toBe(true);
    expect(result.catalogue.medicinalProducts.every((p) => p.domain.code === "Human")).toBe(true);
    expect(result.catalogue.packages.every((p) => p.domain.code === "Human")).toBe(true);
    expect(zol?.identifiers.some((i) => i.system.includes("pl-rpl-preparation-type") && i.value === "ludzki")).toBe(true);
    expect(result.catalogue.medicinalProducts.some((p) => p.authorityKey === "100005709")).toBe(false);
    expect(result.catalogue.packages.some((p) => p.authorityKey === "100005709|52184")).toBe(false);
    expect(pack?.identifiers.some((i) => i.system.includes("pl-rpl-preparation-type"))).toBe(false);

    const sharedGtin = result.catalogue.packages.filter((p) => p.gtin === "05909990998203");
    expect(sharedGtin.map((p) => p.authorityKey).sort()).toEqual(["100282886|151745", "100282886|78318"]);

    const med = fs.readFileSync(path.join(out, "release", "fhir-r4", "Medication.ndjson"), "utf8");
    expect(med).toContain("https://www.gs1.org/gtin");
    expect(med).toContain("pl/rpl/package");
    expect(med).toContain("1× fiol. 5 ml");
    expect(med).toContain("05909991023652");
    expect(med).toContain("StructureDefinition/domain");
    expect(med).toContain("http://hl7.org/fhir/medicinal-product-domain");
    expect(med).not.toContain('"code":"Veterinary"');
    expect(med).not.toContain("weterynaryjny");
    expect(med).not.toContain("pl-rpl-species");
    expect(medicationStatus(pack!)).toBe("active");
    expect(medicationStatus(noGtin!)).toBe("inactive");
    const r4 = med
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as {
        identifier?: { system?: string; value: string }[];
        extension?: { url?: string; valueCoding?: { system?: string; code?: string } }[];
        status?: string;
        amount?: unknown;
        ingredient?: { itemCodeableConcept?: { text?: string } }[];
      });
    const zolR4 = r4.find((m) => m.identifier?.some((i) => i.value === "100000014|2"));
    expect(zolR4?.identifier?.some((i) => i.system?.includes("pl-rpl-preparation-type"))).toBe(false);
    expect(
      zolR4?.extension?.some(
        (e) => e.url?.includes("StructureDefinition/domain") && e.valueCoding?.code === "Human",
      ),
    ).toBe(true);
    expect(r4.some((m) => m.identifier?.some((i) => i.value === "100005709|52184"))).toBe(false);
    expect(zolR4?.status).toBe("active");
    expect(zolR4?.ingredient?.some((i) => i.itemCodeableConcept?.text === "Acidum zoledronicum")).toBe(true);
    expect(
      r4.find((m) => m.identifier?.some((i) => i.value === "100000014|3"))?.amount,
    ).toEqual({
      numerator: { value: 4, unit: "fiol." },
      denominator: { value: 1 },
    });
    expect(
      r4.find((m) => m.identifier?.some((i) => i.value === "100000505|122163"))?.amount,
    ).toBeUndefined();
    const withdrawnR4 = r4.find((m) => m.identifier?.some((i) => i.value === "100000505|122162"));
    expect(withdrawnR4?.status).toBe("inactive");
    expect(withdrawnR4?.ingredient?.some((i) => i.itemCodeableConcept?.text === "Filgrastimum")).toBe(true);

    const mpd = fs.readFileSync(
      path.join(out, "release", "fhir-r5", "MedicinalProductDefinition.ndjson"),
      "utf8",
    );
    expect(mpd).toContain("MedicinalProductDefinition");
    expect(mpd).toContain("/sid/pl/rpl/product");
    expect(mpd).toContain("Edelan");
    expect(mpd).not.toContain("Parvoerysin");
    expect(mpd).toContain("http://hl7.org/fhir/medicinal-product-domain");
    expect(mpd).toContain('"code":"Human"');
    expect(mpd).not.toContain('"code":"Veterinary"');
    expect(mpd).not.toContain("weterynaryjny");
    expect(mpd).toContain('"code":"aktywne"');
    expect(mpd).not.toContain('"code":"skasowane"');
    expect(mpd).not.toContain("Bezterminowe");

    const ppd = fs.readFileSync(
      path.join(out, "release", "fhir-r5", "PackagedProductDefinition.ndjson"),
      "utf8",
    );
    expect(ppd).toContain("packageFor");
    expect(ppd).toContain("05909991023683");
    const ppdRows = ppd
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            identifier?: { value: string }[];
            containedItemQuantity?: { value: number; unit?: string }[];
          },
      );
    expect(
      ppdRows.find((p) => p.identifier?.some((i) => i.value === "100000014|3"))?.containedItemQuantity,
    ).toEqual([{ value: 4, unit: "fiol." }]);
    expect(
      ppdRows.find((p) => p.identifier?.some((i) => i.value === "100000505|122163"))?.containedItemQuantity,
    ).toBeUndefined();

    const r5Dir = path.join(out, "release", "fhir-r5");
    for (const name of [
      "MedicinalProductDefinition.ndjson",
      "PackagedProductDefinition.ndjson",
      "RegulatedAuthorization.ndjson",
      "Ingredient.ndjson",
      "Organization.ndjson",
    ]) {
      expect(fs.existsSync(path.join(r5Dir, name))).toBe(true);
    }
    const ingredients = fs
      .readFileSync(path.join(r5Dir, "Ingredient.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { resourceType: string; substance?: { strength?: Record<string, unknown>[] } });
    expect(ingredients.length).toBeGreaterThan(0);
    for (const ing of ingredients) {
      expect(ing.resourceType).toBe("Ingredient");
      for (const strength of ing.substance?.strength ?? []) {
        expect(strength).not.toHaveProperty("text");
      }
    }
    expect(
      ingredients.some((ing) =>
        ing.substance?.strength?.some((s) => s.textPresentation === "Acidum zoledronicum 4 mg / 5 ml"),
      ),
    ).toBe(true);

    const sqlite = path.join(out, "release", "database", "medication.sqlite");
    const hits = searchPackages(sqlite, "Edelan");
    expect(hits.length).toBeGreaterThan(0);
    const db = new Database(sqlite, { readonly: true });
    const domains = db.prepare("SELECT DISTINCT domain FROM medication_packages ORDER BY domain").all() as {
      domain: string;
    }[];
    db.close();
    expect(domains).toEqual([{ domain: "Human" }]);

    const sourcesMd = fs.readFileSync(path.join(out, "release", "licensing", "SOURCES.md"), "utf8");
    expect(sourcesMd).toContain("creativecommons.org/licenses/by/4.0");
    expect(sourcesMd).toContain("commercialUse: allowed");
  });
});

describe("pl-vet-base fixture build", () => {
  it("includes only veterinary RPL products and emits Veterinary domain", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "omc-pl-vet-"));
    const result = await build({
      artifactId: "pl-vet-base",
      inputBySource: { rpl: repoPath("fixtures/pl/rpl/RPL_FIXTURE.zip") },
      outDir: out,
      dataMonth: "2026.09",
    });
    expect(result.official).toBe(true);
    expect(result.catalogue.medicinalProducts).toHaveLength(1);
    expect(result.catalogue.packages).toHaveLength(1);
    expect(result.catalogue.medicinalProducts.every((p) => p.domain.code === "Veterinary")).toBe(true);
    expect(result.catalogue.packages.every((p) => p.domain.code === "Veterinary")).toBe(true);
    expect(result.catalogue.medicinalProducts.some((p) => p.authorityKey === "100000014")).toBe(false);

    const vet = result.catalogue.medicinalProducts.find((p) => p.authorityKey === "100005709");
    expect(vet?.names[0]?.text).toBe("Parvoerysin");
    expect(vet?.identifiers.some((i) => i.system.includes("pl-rpl-preparation-type") && i.value === "weterynaryjny")).toBe(
      true,
    );
    expect(vet?.domain).toMatchObject({
      system: "http://hl7.org/fhir/medicinal-product-domain",
      code: "Veterinary",
    });
    expect(vet?.identifiers.some((i) => i.system === "http://www.whocc.no/atc" && i.value === "QI09AL01")).toBe(true);
    expect(vet?.identifiers.some((i) => i.system.includes("pl-rpl-species") && i.value === "świnia")).toBe(true);
    expect(vet?.routes[0]?.display).toBe("Podanie domięśniowe");
    expect(vet?.metadata?.okresyKarencji).toBe("świnia | tkanki jadalne: 0.0 dni");
    const vetPack = result.catalogue.packages.find((p) => p.authorityKey === "100005709|52184");
    expect(vetPack?.gtin).toBe("5909991029876");
    expect(vetPack?.description).toBe("1× fiol. 10 ml");
    expect(vetPack?.domain.code).toBe("Veterinary");
    expect(vetPack?.identifiers.some((i) => i.system.includes("pl-rpl-preparation-type"))).toBe(false);

    const med = fs.readFileSync(path.join(out, "release", "fhir-r4", "Medication.ndjson"), "utf8");
    expect(med).toContain("StructureDefinition/domain");
    expect(med).toContain('"code":"Veterinary"');
    expect(med).not.toContain('"code":"Human"');
    expect(med).not.toContain("weterynaryjny");
    const vetR4 = med
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as {
        identifier?: { system?: string; value: string }[];
        extension?: { url?: string; valueCoding?: { system?: string; code?: string } }[];
      })
      .find((m) => m.identifier?.some((i) => i.value === "100005709|52184"));
    expect(vetR4?.identifier?.some((i) => i.system?.includes("pl-rpl-preparation-type"))).toBe(false);
    expect(
      vetR4?.extension?.some(
        (e) => e.url?.includes("StructureDefinition/domain") && e.valueCoding?.code === "Veterinary",
      ),
    ).toBe(true);
    expect(vetR4?.identifier?.some((i) => i.system?.includes("pl-rpl-species"))).toBe(false);

    const mpd = fs.readFileSync(path.join(out, "release", "fhir-r5", "MedicinalProductDefinition.ndjson"), "utf8");
    expect(mpd).toContain("Parvoerysin");
    expect(mpd).toContain('"code":"Veterinary"');
    expect(mpd).toContain("weterynaryjny");
    expect(mpd).not.toContain("Edelan");

    const sqlite = path.join(out, "release", "database", "medication.sqlite");
    const db = new Database(sqlite, { readonly: true });
    const domains = db.prepare("SELECT DISTINCT domain FROM medication_packages").all() as { domain: string }[];
    db.close();
    expect(domains).toEqual([{ domain: "Veterinary" }]);
  });
});

describe("us-base fixture build", () => {
  it("builds SQLite and FHIR from the NDC fixture", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "omc-us-"));
    const result = await build({
      artifactId: "us-base",
      inputBySource: { ndc: repoPath("fixtures/us/ndc/NDC_FIXTURE.zip") },
      outDir: out,
      dataMonth: "2026.09",
    });
    expect(result.official).toBe(true);
    expect(result.catalogue.jurisdiction).toBe("US");
    expect(result.catalogue.productGroups).toHaveLength(0);
    expect(result.catalogue.reimbursements).toHaveLength(0);
    expect(result.catalogue.medicinalProducts).toHaveLength(4);
    expect(result.catalogue.packages).toHaveLength(5);
    expect(result.catalogue.medicinalProducts.every((p) => p.domain.code === "Human")).toBe(true);
    expect(result.catalogue.mappingCoverage[0]?.unknownFields).toEqual([]);
    expect(result.catalogue.mappingCoverage[0]?.fields.find((f) => f.name === "product.txt.nonHuman")?.count).toBe(1);
    expect(result.catalogue.mappingCoverage[0]?.fields.find((f) => f.name === "package.txt.unmatched")?.count).toBe(1);

    const metformin = result.catalogue.medicinalProducts.find((p) => p.authorityKey.startsWith("0002-1433_"));
    expect(metformin?.names.map((n) => n.text)).toEqual(["Metformin XR", "metformin hydrochloride"]);
    expect(metformin?.identifiers.some((i) => i.value === "0002-1433" && i.use === "official")).toBe(true);
    expect(metformin?.routes.map((r) => r.code)).toEqual(["ORAL"]);
    expect(metformin?.ingredients[0]?.strength).toMatchObject({
      numeratorValue: "500",
      numeratorUnit: { code: "mg" },
      denominatorValue: "1",
      denominatorUnit: { code: "1" },
      text: "500 mg/1",
      structured: true,
    });
    expect(result.catalogue.authorizations.find((a) => a.authorityKey === metformin?.authorityKey)?.identifiers).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "NDA021123" })]),
    );
    expect(result.catalogue.organizations.find((o) => o.authorityKey === "0002")?.name).toBe("Eli Lilly and Company");

    const bottle = result.catalogue.packages.find((p) => p.authorityKey === "0002-1433-01");
    expect(bottle?.marketingValidFrom).toBe("2020-01-15");
    expect(bottle?.quantity).toMatchObject({ value: "100", unit: { code: "TABLET" }, structured: true });
    expect(bottle?.identifiers.some((i) => i.system.endsWith("/ndc-11") && i.value === "00002143301")).toBe(true);
    expect(bottle?.gtin).toBeUndefined();
    expect(medicationStatus(bottle!)).toBeUndefined();

    const sample = result.catalogue.packages.find((p) => p.authorityKey === "0002-1433-02");
    expect(sample?.metadata?.samplePackage).toBe("Y");
    expect(sample?.identifiers.some((i) => i.value === "00002143302")).toBe(true);

    const otc = result.catalogue.packages.find((p) => p.authorityKey === "12345-678-90");
    expect(otc?.identifiers.some((i) => i.value === "12345067890")).toBe(true);
    expect(otc?.regulatoryStatus.code).toBe("OTC MONOGRAPH FINAL");

    const combo = result.catalogue.medicinalProducts.find((p) => p.names[0]?.text === "Cobenfy");
    expect(combo?.routes.map((r) => r.code)).toEqual(["ORAL", "TOPICAL"]);
    expect(combo?.ingredients).toHaveLength(2);
    expect(combo?.ingredients.every((i) => i.strength.structured)).toBe(true);
    expect(combo?.metadata?.deaSchedule).toBe("CII");
    const kit = result.catalogue.packages.find((p) => p.authorityKey === "67890-1234-1");
    expect(kit?.quantity).toEqual({ structured: false });
    expect(kit?.identifiers.some((i) => i.value === "67890123401")).toBe(true);
    expect(kit?.marketingStatus?.code).toBe("active");
    expect(kit?.marketingValidTo).toBe("2027-12-31");

    const ended = result.catalogue.packages.find((p) => p.authorityKey === "0002-9999-01");
    expect(ended?.marketingStatus?.code).toBe("inactive");
    const old = result.catalogue.medicinalProducts.find((p) => p.authorityKey.startsWith("0002-9999_"));
    expect(old?.ingredients.every((i) => i.strength.structured === false)).toBe(true);

    expect(result.catalogue.medicinalProducts.some((p) => p.names[0]?.text === "Vetmed")).toBe(false);

    const med = fs.readFileSync(path.join(out, "release", "fhir-r4", "Medication.ndjson"), "utf8");
    expect(med).toContain("00002143301");
    expect(med).toContain("METFORMIN HYDROCHLORIDE");
    expect(med).toContain('"value":500');

    const sourcesMd = fs.readFileSync(path.join(out, "release", "licensing", "SOURCES.md"), "utf8");
    expect(sourcesMd).toContain("website-policies#linking");
    expect(sourcesMd).toContain("attributionRequired: false");

    const sqlite = path.join(out, "release", "database", "medication.sqlite");
    expect(searchPackages(sqlite, "Metformin").length).toBeGreaterThan(0);
  });
});
