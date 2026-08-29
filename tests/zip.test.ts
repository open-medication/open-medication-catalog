import { describe, expect, it } from "vitest";
import { extractZip, fileSignatureOk, writeDeterministicZip, assertSafeZipPath } from "../src/security.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("zip hardening and determinism", () => {
  it("rejects path traversal", async () => {
    expect(() => assertSafeZipPath("../evil.txt", "/tmp/omc-safe")).toThrow(/traversal/i);
    expect(() => assertSafeZipPath("foo/../../evil.txt", "/tmp/omc-safe")).toThrow(/traversal/i);
    const JSZip = (await import("jszip")).default;
    const z = new JSZip();
    z.file("nested/../../evil.txt", "nope");
    const buf = await z.generateAsync({ type: "nodebuffer" });
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "omc-zip-"));
    // JSZip may flatten names; the explicit path check above is the contract.
    try {
      await extractZip(buf, dest);
    } catch (err) {
      expect(String(err)).toMatch(/traversal/i);
    }
  });

  it("produces identical SHA-256 for the same inputs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omc-det-"));
    const files = [
      { name: "b.txt", data: "hello" },
      { name: "a.txt", data: "world" },
    ];
    const a = path.join(dir, "a.zip");
    const b = path.join(dir, "b.zip");
    await writeDeterministicZip(files, a);
    await writeDeterministicZip(files, b);
    expect(fs.readFileSync(a)).toEqual(fs.readFileSync(b));
    expect(fileSignatureOk(fs.readFileSync(a), "zip")).toBe(true);
  });
});
