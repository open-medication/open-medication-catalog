import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractTermsFragment, looksLikePdf, termsChecksum, termsChecksumBytes } from "../src/pipeline/terms.js";

const FIXTURE = `<html><body>
<nav>cookie banner changing weekly 123</nav>
<h2>The 4 terms of use</h2>
<p><img id="terms_open" alt="" /><b>Open use</b></p>
<ul>
<li>You may use this dataset for non-commercial purposes.</li>
<li>You may use this dataset for commercial purposes.</li>
<li>You are recommended to provide the source.</li>
</ul>
<p><img id="terms_by" alt="" /><strong>Open use. Must provide the source.</strong></p>
</body></html>`;

describe("extractTermsFragment", () => {
  it("hashes only the terms_open block so page chrome is ignored", () => {
    const fragment = extractTermsFragment(FIXTURE, "terms_open");
    expect(fragment).toContain("Open use");
    expect(fragment).toContain("commercial purposes");
    expect(fragment).not.toContain("cookie banner");
    expect(fragment).not.toContain("Must provide the source");

    const a = termsChecksum(FIXTURE, "terms_open");
    const b = termsChecksum(FIXTURE.replace("123", "999"), "terms_open");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails when the fragment id is missing", () => {
    expect(() => extractTermsFragment("<p>no ids</p>", "terms_open")).toThrow(/not found/);
  });

  it("hashes an h2 section so the rest of the page is ignored", () => {
    const html = `<nav>chrome 1</nav><h2 id="linking">Linking</h2><p>public domain</p><h2 id="other">Other</h2><p>cookie</p>`;
    const fragment = extractTermsFragment(html, "linking");
    expect(fragment).toContain("public domain");
    expect(fragment).not.toContain("chrome");
    expect(fragment).not.toContain("cookie");
    const a = termsChecksum(html, "linking");
    const b = termsChecksum(html.replace("chrome 1", "chrome 2"), "linking");
    expect(a).toBe(b);
  });
});

describe("termsChecksumBytes", () => {
  it("hashes PDF bytes, not UTF-8-normalized HTML", () => {
    const pdf = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n", "latin1");
    const asHtml = termsChecksum(pdf.toString("utf8"));
    const asPdf = termsChecksumBytes(pdf, { url: "https://example.org/licence.pdf" });
    expect(looksLikePdf(pdf, "https://example.org/licence.pdf")).toBe(true);
    expect(asPdf).toBe(createHash("sha256").update(pdf).digest("hex"));
    expect(asPdf).not.toBe(asHtml);
  });

  it("still hashes HTML through the text normalizer", () => {
    const html = Buffer.from("<html><body>  Hello <b>World</b>  </body></html>");
    expect(termsChecksumBytes(html, { url: "https://example.org/terms" })).toBe(termsChecksum(html.toString("utf8")));
  });
});
