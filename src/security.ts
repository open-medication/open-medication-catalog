import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const DEFAULT_MAX_DOWNLOAD = 500 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED = 2 * 1024 * 1024 * 1024;

export interface FetchOptions {
  headers?: Record<string, string>;
  maxBytes?: number;
  allowedContentTypes?: string[];
  /** Extra GET attempts after a retryable HTTP status. Default 2 (3 tries total). */
  retries?: number;
  retryDelayMs?: number;
}

/** CMS/WAF noise seen on Refdata terms (415) plus typical transient gateway codes. */
export const RETRYABLE_HTTP_STATUS = new Set([408, 415, 425, 429, 500, 502, 503, 504]);

function assertHttpUrl(url: string): void {
  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    throw new Error(`Refusing non-http(s) URL: ${url}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBinaryOnce(url: string, opts: FetchOptions): Promise<Buffer> {
  const res = await fetch(url, { headers: opts.headers, redirect: "follow" });
  if (!res.ok) {
    throw new HttpStatusError(url, res.status, res.statusText);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (opts.allowedContentTypes && opts.allowedContentTypes.length > 0) {
    const ok = opts.allowedContentTypes.some((t) => contentType.toLowerCase().includes(t.toLowerCase()));
    if (!ok && contentType) {
      // Some servers send application/octet-stream for zip; allow that.
      if (!contentType.includes("octet-stream") && !contentType.includes("zip")) {
        throw new Error(`Unexpected content-type ${contentType} for ${url}`);
      }
    }
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const max = opts.maxBytes ?? DEFAULT_MAX_DOWNLOAD;
  if (buf.length > max) {
    throw new Error(`Download exceeded ${max} bytes (${url})`);
  }
  return buf;
}

export async function fetchBinary(url: string, opts: FetchOptions = {}): Promise<Buffer> {
  assertHttpUrl(url);
  const retries = opts.retries ?? 2;
  const delay = opts.retryDelayMs ?? 250;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchBinaryOnce(url, opts);
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof HttpStatusError && RETRYABLE_HTTP_STATUS.has(err.status);
      if (!retryable || attempt === retries) throw err;
      if (delay > 0) await sleep(delay * (attempt + 1));
    }
  }
  throw lastErr;
}

export class HttpStatusError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    statusText: string,
  ) {
    super(`HTTP ${status} ${statusText} for ${url}`);
  }
}

const MISSING = new Set([404, 403]);

/** True when HEAD (or a tiny ranged GET) says the URL exists. Throws on unexpected 5xx. */
export async function httpExists(url: string): Promise<boolean> {
  assertHttpUrl(url);
  const head = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (head.status === 200) return true;
  if (MISSING.has(head.status)) return false;
  if (head.status === 405 || head.status === 501) {
    const ranged = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
    });
    if (ranged.ok) return true;
    if (MISSING.has(ranged.status)) return false;
    throw new HttpStatusError(url, ranged.status, ranged.statusText);
  }
  throw new HttpStatusError(url, head.status, head.statusText);
}

export function assertSafeZipPath(name: string, destAbs: string): string {
  const normalized = name.replace(/\\/g, "/");
  if (normalized.includes("..") || path.isAbsolute(normalized) || normalized.startsWith("/")) {
    throw new Error(`ZIP path traversal rejected: ${name}`);
  }
  const target = path.resolve(destAbs, normalized);
  const prefix = destAbs.endsWith(path.sep) ? destAbs : destAbs + path.sep;
  if (target !== destAbs && !target.startsWith(prefix)) {
    throw new Error(`ZIP path traversal rejected: ${name}`);
  }
  return target;
}

export async function extractZip(buf: Buffer, destDir: string, opts?: { maxUncompressed?: number }): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const max = opts?.maxUncompressed ?? DEFAULT_MAX_UNCOMPRESSED;
  let total = 0;
  const written: string[] = [];
  const destAbs = path.resolve(destDir);
  fs.mkdirSync(destAbs, { recursive: true });

  const names = Object.keys(zip.files).sort();
  for (const name of names) {
    const entry = zip.files[name];
    if (!entry || entry.dir) continue;
    const target = assertSafeZipPath(name, destAbs);
    const data = await entry.async("nodebuffer");
    total += data.length;
    if (total > max) {
      throw new Error(`ZIP uncompressed size exceeded ${max} bytes`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written.push(target);
  }
  return written;
}

/** Binary-reproducible ZIP: fixed DOS time, sorted names, unix 0644. */
export async function writeDeterministicZip(
  files: { name: string; data: Buffer | string }[],
  destFile: string,
): Promise<void> {
  const zip = new JSZip();
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const stamp = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
  for (const f of sorted) {
    zip.file(f.name.replace(/\\/g, "/"), f.data, {
      date: stamp,
      unixPermissions: 0o644,
      createFolders: false,
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    platform: "UNIX",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, buf);
}

export function fileSignatureOk(buf: Buffer, kind: "zip" | "xml"): boolean {
  if (kind === "zip") {
    return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  }
  const head = buf.subarray(0, 128).toString("utf8").trimStart();
  return head.startsWith("<?xml") || head.startsWith("<");
}

export function sha256(buf: Buffer | string): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
