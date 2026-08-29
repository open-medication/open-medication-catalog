import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const XML_ARRAY_TAGS = new Set([
  "PRAEPARAT",
  "SEQUENZ",
  "PACKUNG",
  "DEKLARATION",
  "ADRESSEN",
  "UDC",
  "ATC",
  "APPLIKATIONSART",
  "SYNONYME",
  "DATUM",
  "ARTICLE",
  "ARTICLES",
]);

/** XML values stay strings. Never let the parser turn 001 into 1. */
export function stringXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    isArray: (name) => XML_ARRAY_TAGS.has(name),
  });
}

export function parseXmlFile(filePath: string): unknown {
  const xml = fs.readFileSync(filePath, "utf8");
  return parseXmlString(xml);
}

export function parseXmlString(xml: string): unknown {
  // Disallow DTD / external entities before parse.
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error("XML contains a DOCTYPE or ENTITY declaration (rejected)");
  }
  return stringXmlParser().parse(xml);
}

export function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") {
    throw new Error(`XML numeric coercion leaked into parser: ${value}`);
  }
  if (typeof value === "boolean") {
    throw new Error(`XML boolean coercion leaked into parser: ${value}`);
  }
  return String(value);
}

export function optionalText(value: unknown): string | undefined {
  const t = text(value).trim();
  return t.length === 0 ? undefined : t;
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

export function sha256Buffer(buf: Buffer | string): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function copyFile(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}
