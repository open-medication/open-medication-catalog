import { describe, expect, it } from "vitest";
import { BagAdapter } from "../src/adapters/ch/bag.js";
import { RefdataAdapter } from "../src/adapters/ch/refdata.js";
import { SwissmedicAdapter } from "../src/adapters/ch/swissmedic.js";
import { listSourceDirs, loadSourceDescriptorById } from "../src/adapters/descriptor.js";
import { licensingTexts, sourceLicensing } from "../src/pipeline/licensing.js";
import { allSourceLicences, sourcesForArtifact } from "../site/src/lib/licences.ts";

const adapters = [new SwissmedicAdapter(), new RefdataAdapter(), new BagAdapter()];

describe("licence flags from source.yaml", () => {
  it("metadata matches YAML for every adapter", () => {
    for (const adapter of adapters) {
      const meta = adapter.metadata();
      const desc = loadSourceDescriptorById(meta.sourceId);
      expect(meta.commercialUse).toBe(desc.commercialUse);
      expect(meta.redistribution).toBe(desc.redistribution);
      expect(meta.attributionRequired).toBe(desc.attributionRequired);
      expect(meta.termsUrl).toBe(desc.terms.url);
      expect(meta.updateFrequency).toBe(desc.updateFrequency);
      expect(meta.credentialsRequired).toBe(desc.credentialsRequired);
      expect(meta.identityAuthority).toBe(desc.identityAuthority);
    }
  });

  it("discovers every committed source.yaml", () => {
    expect(listSourceDirs().map((s) => s.sourceId).sort()).toEqual(["bag", "refdata", "swissmedic"]);
  });

  it("site download rows match YAML and artifact recipes", () => {
    const swiss = loadSourceDescriptorById("swissmedic");
    const row = allSourceLicences().find((s) => s.sourceId === "swissmedic");
    expect(row?.termsUrl).toBe(swiss.terms.url);
    expect(row?.commercialUse).toBe(swiss.commercialUse);
    expect(row?.redistribution).toBe(swiss.redistribution);
    expect(allSourceLicences().map((s) => s.sourceId)).toEqual(["swissmedic", "refdata", "bag"]);
    expect(sourcesForArtifact("ch-base").map((s) => s.sourceId)).toEqual(["swissmedic"]);
    expect(sourcesForArtifact("ch-enriched").map((s) => s.sourceId)).toEqual(["swissmedic", "refdata"]);
  });
});

describe("release licensing texts", () => {
  it("writes a misclassification disclaimer and upstream terms URLs", () => {
    const swiss = loadSourceDescriptorById("swissmedic");
    const texts = licensingTexts(
      [
        {
          id: "x",
          sourceId: "swissmedic",
          identityAuthority: "swissmedic",
          retrievedAt: "1970-01-01T00:00:00.000Z",
          sha256: "abc",
          uri: "file:test",
        },
      ],
      ["swissmedic"],
    );
    const readme = texts.find((t) => t.name === "README.md")?.text ?? "";
    const sources = texts.find((t) => t.name === "SOURCES.md")?.text ?? "";
    expect(readme).toMatch(/not liable for misinterpreting/i);
    expect(readme).toMatch(/do not control/i);
    expect(readme).toMatch(/cross-check/i);
    expect(sources).toContain(swiss.terms.url);
    expect(sources).toContain(`commercialUse: ${swiss.commercialUse}`);
    expect(sources).toContain("attributionRequired: true");
    expect(sourceLicensing("swissmedic").fragment).toBe("terms_open");
  });
});
