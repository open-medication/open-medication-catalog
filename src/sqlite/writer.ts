import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Catalogue } from "../canonical/types.js";

export function writeSqlite(catalogue: Catalogue, destFile: string): void {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  if (fs.existsSync(destFile)) fs.unlinkSync(destFile);
  const db = new Database(destFile);
  db.pragma("journal_mode = OFF");
  db.exec(`
    CREATE TABLE product_group (
      id TEXT PRIMARY KEY,
      jurisdiction TEXT NOT NULL,
      identity_authority TEXT NOT NULL,
      authority_key TEXT NOT NULL,
      name TEXT NOT NULL,
      atc_code TEXT,
      regulatory_status TEXT NOT NULL,
      authorization_holder_id TEXT
    );
    CREATE TABLE medicinal_product (
      id TEXT PRIMARY KEY,
      product_group_id TEXT,
      jurisdiction TEXT NOT NULL,
      identity_authority TEXT NOT NULL,
      authority_key TEXT NOT NULL,
      name TEXT NOT NULL,
      dose_form TEXT,
      regulatory_status TEXT NOT NULL
    );
    CREATE TABLE package (
      id TEXT PRIMARY KEY,
      medicinal_product_id TEXT NOT NULL,
      product_group_id TEXT,
      jurisdiction TEXT NOT NULL,
      identity_authority TEXT NOT NULL,
      authority_key TEXT NOT NULL,
      description TEXT NOT NULL,
      quantity_value TEXT,
      quantity_unit TEXT,
      quantity_structured INTEGER NOT NULL,
      gtin TEXT,
      regulatory_status TEXT NOT NULL,
      marketing_status TEXT,
      reimbursement_status TEXT
    );
    CREATE TABLE organization (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      authority_key TEXT NOT NULL
    );
    CREATE TABLE authorization (
      id TEXT PRIMARY KEY,
      authority_key TEXT NOT NULL,
      status TEXT NOT NULL,
      holder_id TEXT
    );
    CREATE TABLE ingredient (
      id TEXT PRIMARY KEY,
      medicinal_product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT,
      strength_text TEXT,
      structured INTEGER NOT NULL
    );
    CREATE TABLE identifier (
      entity_id TEXT NOT NULL,
      system TEXT NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE source_snapshot (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      identity_authority TEXT NOT NULL,
      source_effective_date TEXT,
      retrieved_at TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      uri TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE package_fts USING fts5(
      package_id UNINDEXED,
      name,
      description,
      gtin,
      identifiers
    );
    CREATE VIEW medication_packages AS
      SELECT
        p.id AS package_id,
        p.description AS package_description,
        p.gtin,
        p.authority_key AS source_package_id,
        mp.id AS medicinal_product_id,
        mp.name AS product_name,
        mp.authority_key AS source_product_id,
        pg.id AS product_group_id,
        pg.name AS group_name,
        p.regulatory_status,
        p.marketing_status,
        p.reimbursement_status,
        p.quantity_value,
        p.quantity_unit,
        p.jurisdiction
      FROM package p
      JOIN medicinal_product mp ON mp.id = p.medicinal_product_id
      LEFT JOIN product_group pg ON pg.id = p.product_group_id;
  `);

  const insG = db.prepare(
    `INSERT INTO product_group VALUES (@id,@jurisdiction,@identity_authority,@authority_key,@name,@atc_code,@regulatory_status,@authorization_holder_id)`,
  );
  const insMp = db.prepare(
    `INSERT INTO medicinal_product VALUES (@id,@product_group_id,@jurisdiction,@identity_authority,@authority_key,@name,@dose_form,@regulatory_status)`,
  );
  const insP = db.prepare(
    `INSERT INTO package VALUES (@id,@medicinal_product_id,@product_group_id,@jurisdiction,@identity_authority,@authority_key,@description,@quantity_value,@quantity_unit,@quantity_structured,@gtin,@regulatory_status,@marketing_status,@reimbursement_status)`,
  );
  const insO = db.prepare(`INSERT INTO organization VALUES (@id,@name,@role,@authority_key)`);
  const insA = db.prepare(`INSERT INTO authorization VALUES (@id,@authority_key,@status,@holder_id)`);
  const insI = db.prepare(
    `INSERT INTO ingredient VALUES (@id,@medicinal_product_id,@name,@role,@strength_text,@structured)`,
  );
  const insId = db.prepare(`INSERT INTO identifier VALUES (@entity_id,@system,@value)`);
  const insS = db.prepare(
    `INSERT INTO source_snapshot VALUES (@id,@source_id,@identity_authority,@source_effective_date,@retrieved_at,@sha256,@uri)`,
  );
  const insFts = db.prepare(
    `INSERT INTO package_fts (package_id, name, description, gtin, identifiers) VALUES (?,?,?,?,?)`,
  );

  const tx = db.transaction(() => {
    for (const g of catalogue.productGroups) {
      insG.run({
        id: g.id,
        jurisdiction: g.jurisdiction,
        identity_authority: g.identityAuthority,
        authority_key: g.authorityKey,
        name: g.names[0]?.text ?? "",
        atc_code: g.atc?.code ?? null,
        regulatory_status: g.regulatoryStatus.code,
        authorization_holder_id: g.authorizationHolderId ?? null,
      });
      for (const id of g.identifiers) insId.run({ entity_id: g.id, system: id.system, value: id.value });
    }
    for (const mp of catalogue.medicinalProducts) {
      insMp.run({
        id: mp.id,
        product_group_id: mp.productGroupId ?? null,
        jurisdiction: mp.jurisdiction,
        identity_authority: mp.identityAuthority,
        authority_key: mp.authorityKey,
        name: mp.names[0]?.text ?? "",
        dose_form: mp.doseForm?.display ?? mp.doseForm?.code ?? null,
        regulatory_status: mp.regulatoryStatus.code,
      });
      for (const id of mp.identifiers) insId.run({ entity_id: mp.id, system: id.system, value: id.value });
      for (const ing of mp.ingredients) {
        insI.run({
          id: ing.id,
          medicinal_product_id: mp.id,
          name: ing.name,
          role: ing.role.display ?? ing.role.code,
          strength_text: ing.strength.text ?? null,
          structured: ing.strength.structured ? 1 : 0,
        });
      }
    }
    for (const pkg of catalogue.packages) {
      insP.run({
        id: pkg.id,
        medicinal_product_id: pkg.medicinalProductId,
        product_group_id: pkg.productGroupId ?? null,
        jurisdiction: pkg.jurisdiction,
        identity_authority: pkg.identityAuthority,
        authority_key: pkg.authorityKey,
        description: pkg.description,
        quantity_value: pkg.quantity.value ?? null,
        quantity_unit: pkg.quantity.unit?.display ?? pkg.quantity.unit?.code ?? null,
        quantity_structured: pkg.quantity.structured ? 1 : 0,
        gtin: pkg.gtin ?? null,
        regulatory_status: pkg.regulatoryStatus.code,
        marketing_status: pkg.marketingStatus?.code ?? null,
        reimbursement_status: pkg.reimbursementStatus?.code ?? null,
      });
      for (const id of pkg.identifiers) insId.run({ entity_id: pkg.id, system: id.system, value: id.value });
      const mp = catalogue.medicinalProducts.find((m) => m.id === pkg.medicinalProductId);
      insFts.run(
        pkg.id,
        mp?.names[0]?.text ?? "",
        pkg.description,
        pkg.gtin ?? "",
        pkg.identifiers.map((i) => i.value).join(" "),
      );
    }
    for (const o of catalogue.organizations) {
      insO.run({ id: o.id, name: o.name, role: o.role, authority_key: o.authorityKey });
    }
    for (const a of catalogue.authorizations) {
      insA.run({
        id: a.id,
        authority_key: a.authorityKey,
        status: a.status.code,
        holder_id: a.holderId ?? null,
      });
    }
    for (const s of catalogue.sourceSnapshots) {
      insS.run({
        id: s.id,
        source_id: s.sourceId,
        identity_authority: s.identityAuthority,
        source_effective_date: s.sourceEffectiveDate ?? null,
        retrieved_at: s.retrievedAt,
        sha256: s.sha256,
        uri: s.uri,
      });
    }
  });
  tx();
  db.close();
}

export function searchPackages(dbFile: string, query: string): Record<string, unknown>[] {
  const db = new Database(dbFile, { readonly: true });
  const like = `%${query}%`;
  const rows = db
    .prepare(
      `SELECT * FROM medication_packages
       WHERE product_name LIKE @q COLLATE NOCASE
          OR package_description LIKE @q COLLATE NOCASE
          OR ifnull(gtin,'') LIKE @q
          OR source_package_id LIKE @q
          OR source_product_id LIKE @q
       LIMIT 50`,
    )
    .all({ q: like });
  db.close();
  return rows as Record<string, unknown>[];
}
