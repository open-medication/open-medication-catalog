import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { sourceDirFor, listSourceDirs } from "../adapters/descriptor.js";
import { fetchBinary } from "../security.js";

/** Override Node fetch defaults (`Accept-Language: *`) that some CMS stacks reject with 415. */
export const TERMS_PAGE_HEADERS = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en,de;q=0.8",
  "User-Agent": "open-medication-catalog (terms-check; https://github.com/open-medication/open-medication-catalog)",
};

export interface TermsStatus {
  sourceId: string;
  url: string;
  reviewedAt: string;
  storedChecksum?: string;
  currentChecksum?: string;
  changed: boolean;
  fetchError?: string;
}

function normalizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Slice one opendata.swiss terms_* definition so site chrome does not bust the checksum. */
export function extractTermsFragment(html: string, fragmentId: string): string {
  const matches = [...html.matchAll(/id=["'](terms_[a-z0-9_]+)["']/gi)];
  const idx = matches.findIndex((m) => m[1]!.toLowerCase() === fragmentId.toLowerCase());
  if (idx < 0) {
    throw new Error(`Terms fragment #${fragmentId} not found`);
  }
  const start = matches[idx]!.index!;
  const tagStart = html.lastIndexOf("<", start);
  const from = tagStart >= 0 ? tagStart : start;
  const next = matches[idx + 1];
  const to = next ? html.lastIndexOf("<", next.index!) : html.length;
  if (to <= from) {
    throw new Error(`Terms fragment #${fragmentId} has empty bounds`);
  }
  return html.slice(from, to);
}

export function termsChecksum(html: string, fragmentId?: string): string {
  const slice = fragmentId ? extractTermsFragment(html, fragmentId) : html;
  return crypto.createHash("sha256").update(normalizeHtml(slice)).digest("hex");
}

export function looksLikePdf(buf: Buffer, url = ""): boolean {
  const pathOnly = url.toLowerCase().split("?")[0] ?? "";
  if (pathOnly.endsWith(".pdf")) return true;
  return buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** HTML pages: normalized text. PDFs: SHA-256 of the raw bytes. */
export function termsChecksumBytes(buf: Buffer, opts?: { url?: string; fragment?: string }): string {
  if (looksLikePdf(buf, opts?.url ?? "")) {
    return crypto.createHash("sha256").update(buf).digest("hex");
  }
  return termsChecksum(buf.toString("utf8"), opts?.fragment);
}

export async function checkTerms(sourceDir: string): Promise<TermsStatus> {
  const desc = YAML.parse(fs.readFileSync(path.join(sourceDir, "source.yaml"), "utf8")) as {
    sourceId: string;
    terms: { url: string; reviewedAt: string; checksum?: string; fragment?: string };
  };
  const snapFile = path.join(sourceDir, "terms.snapshot.txt");
  let stored: string | undefined;
  if (fs.existsSync(snapFile)) stored = fs.readFileSync(snapFile, "utf8").trim();
  if (desc.terms.checksum) stored = desc.terms.checksum;
  let current: string | undefined;
  let fetchError: string | undefined;
  try {
    const buf = await fetchBinary(desc.terms.url, {
      maxBytes: 5 * 1024 * 1024,
      headers: TERMS_PAGE_HEADERS,
    });
    current = termsChecksumBytes(buf, { url: desc.terms.url, fragment: desc.terms.fragment });
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
  }
  const changed = Boolean(stored && current && stored !== current);
  return {
    sourceId: desc.sourceId,
    url: desc.terms.url,
    reviewedAt: desc.terms.reviewedAt,
    storedChecksum: stored,
    currentChecksum: current,
    changed,
    fetchError,
  };
}

export async function checkAllTerms(): Promise<TermsStatus[]> {
  const out: TermsStatus[] = [];
  for (const { dir } of listSourceDirs()) {
    out.push(await checkTerms(dir));
  }
  return out;
}

/**
 * Official redistribution is blocked when a terms page checksum no longer
 * matches the reviewed snapshot, or when the live page cannot be fetched.
 */
export async function assertTermsAllowRedistribution(sourceIds: string[]): Promise<void> {
  const unique = [...new Set(sourceIds)];
  const problems: string[] = [];
  for (const id of unique) {
    const dir = sourceDirFor(id);
    if (!dir) continue;
    const status = await checkTerms(dir);
    if (!status.storedChecksum) {
      problems.push(`${id}: no terms snapshot committed`);
    }
    if (status.fetchError) {
      problems.push(`${id}: could not fetch terms (${status.fetchError})`);
    }
    if (status.changed) {
      problems.push(
        `${id}: terms page changed (stored ${status.storedChecksum}, live ${status.currentChecksum}). Update terms.reviewedAt and the snapshot after review.`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(`Terms change blocks redistribution:\n${problems.join("\n")}`);
  }
}
