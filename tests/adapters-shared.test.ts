import { describe, expect, it } from "vitest";
import { sourceCodedValue } from "../src/adapters/shared/coded.js";
import { compactMeta } from "../src/adapters/shared/meta.js";
import { splitDelimitedList, splitParentheticalCommaList } from "../src/adapters/shared/lists.js";
import { createOrganizationUpserter } from "../src/adapters/shared/organizations.js";
import type { Organization, SourceSnapshot } from "../src/canonical/types.js";

const snapshot: SourceSnapshot = {
  id: "snap",
  sourceId: "test",
  identityAuthority: "test",
  retrievedAt: "1970-01-01T00:00:00.000Z",
  sha256: "abc",
  uri: "file:test",
};

describe("shared adapter helpers", () => {
  it("compacts metadata", () => {
    expect(compactMeta({ a: " 1 ", b: "", c: undefined })).toEqual({ a: "1" });
    expect(compactMeta({ blank: "   " })).toBeUndefined();
  });

  it("splits delimited and parenthetical lists", () => {
    expect(splitDelimitedList("a; b;;c", ";")).toEqual(["a", "b", "c"]);
    expect(splitParentheticalCommaList("A, B (JERYL LYNN, STRAIN), C")).toEqual([
      "A",
      "B (JERYL LYNN, STRAIN)",
      "C",
    ]);
  });

  it("maps coded values with optional blank sentinels", () => {
    expect(sourceCodedValue("https://example.org", " Valid ")).toEqual({
      system: "https://example.org",
      code: "Valid",
      display: "Valid",
    });
    expect(sourceCodedValue("https://example.org", "--", { blankSentinels: ["--"] })).toBeUndefined();
  });

  it("deduplicates organizations by map key", () => {
    const orgByKey = new Map<string, Organization>();
    const organizations: Organization[] = [];
    const upsertOrg = createOrganizationUpserter({
      jurisdiction: "SA",
      identityAuthority: "sfda",
      organizationSystem: "https://example.org/org",
      snapshot,
      sourceRef: (snap, recordKey) => ({ sourceId: "sfda", snapshotId: snap.id, recordKey }),
    });
    const first = upsertOrg(orgByKey, organizations, "Example Plant", "manufacturer");
    const second = upsertOrg(orgByKey, organizations, "Example Plant", "manufacturer");
    expect(first?.id).toBe(second?.id);
    expect(organizations).toHaveLength(1);
  });
});
