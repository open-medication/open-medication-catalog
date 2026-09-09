import { describe, expect, it } from "vitest";
import { extractTermsFragment, termsChecksum } from "../src/pipeline/terms.js";

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
});
