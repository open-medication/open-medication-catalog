import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { repoPath } from "../paths.js";
import { fetchBinary } from "../security.js";

export interface TermsStatus {
  sourceId: string;
  url: string;
  reviewedAt: string;
  storedChecksum?: string;
  currentChecksum?: string;
  changed: boolean;
  fetchError?: string;
}

const SOURCE_DIRS: Record<string, string> = {
  swissmedic: repoPath("adapters/ch/swissmedic"),
  refdata: repoPath("adapters/ch/refdata"),
  bag: repoPath("adapters/ch/bag"),
};

function normalizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export async function checkTerms(sourceDir: string): Promise<TermsStatus> {
  const desc = YAML.parse(fs.readFileSync(path.join(sourceDir, "source.yaml"), "utf8")) as {
    sourceId: string;
    terms: { url: string; reviewedAt: string; checksum?: string };
  };
  const snapFile = path.join(sourceDir, "terms.snapshot.txt");
  let stored: string | undefined;
  if (fs.existsSync(snapFile)) stored = fs.readFileSync(snapFile, "utf8").trim();
  if (desc.terms.checksum) stored = desc.terms.checksum;
  let current: string | undefined;
  let fetchError: string | undefined;
  try {
    const buf = await fetchBinary(desc.terms.url, { maxBytes: 5 * 1024 * 1024 });
    current = crypto.createHash("sha256").update(normalizeHtml(buf.toString("utf8"))).digest("hex");
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
  for (const d of Object.values(SOURCE_DIRS)) {
    if (fs.existsSync(path.join(d, "source.yaml"))) out.push(await checkTerms(d));
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
    const dir = SOURCE_DIRS[id];
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
