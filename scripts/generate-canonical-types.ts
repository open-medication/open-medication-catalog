/**
 * Generate TypeScript types from the canonical JSON Schema.
 * Schema is the source of truth; do not edit src/canonical/generated.ts by hand.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = path.join(root, "canonical/schema/catalogue.schema.json");
const out = path.join(root, "src/canonical/generated.ts");

const ts = await compileFromFile(schema, {
  bannerComment:
    "/* eslint-disable */\n/** Generated from canonical/schema/catalogue.schema.json. Do not edit. */",
  additionalProperties: false,
  style: { singleQuote: false },
  unreachableDefinitions: true,
});

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${ts.trimEnd()}\n`);
console.log(`wrote ${path.relative(root, out)}`);
