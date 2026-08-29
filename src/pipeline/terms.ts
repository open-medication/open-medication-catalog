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
  try {
    const buf = await fetchBinary(desc.terms.url, { maxBytes: 5 * 1024 * 1024 });
    current = crypto.createHash("sha256").update(normalizeHtml(buf.toString("utf8"))).digest("hex");
  } catch {
    current = stored;
  }
  const changed = Boolean(stored && current && stored !== current);
  return {
    sourceId: desc.sourceId,
    url: desc.terms.url,
    reviewedAt: desc.terms.reviewedAt,
    storedChecksum: stored,
    currentChecksum: current,
    changed,
  };
}

export async function checkAllTerms(): Promise<TermsStatus[]> {
  const dirs = [
    repoPath("adapters/ch/swissmedic"),
    repoPath("adapters/ch/refdata"),
    repoPath("adapters/ch/bag"),
  ];
  const out: TermsStatus[] = [];
  for (const d of dirs) {
    if (fs.existsSync(path.join(d, "source.yaml"))) out.push(await checkTerms(d));
  }
  return out;
}
