import { describe, expect, it, vi, afterEach } from "vitest";
import { addDataMonths, monthsToProbe, parseDataMonth } from "../src/pipeline/dates.js";
import {
  githubOutputLines,
  lastShippedMonth,
  resolveNextDataMonth,
} from "../src/pipeline/discover.js";
import { httpExists, HttpStatusError } from "../src/security.js";

describe("data month arithmetic", () => {
  it("shifts across year boundaries", () => {
    expect(addDataMonths("2026.12", 1)).toBe("2027.01");
    expect(addDataMonths("2026.01", -1)).toBe("2025.12");
    expect(addDataMonths("2026.09", -12)).toBe("2025.09");
  });

  it("probes months after last shipped through current", () => {
    expect(monthsToProbe({ lastShipped: "2026.07", current: "2026.09" })).toEqual([
      "2026.08",
      "2026.09",
    ]);
  });

  it("looks back when nothing has shipped", () => {
    const months = monthsToProbe({ current: "2026.09", lookbackMonths: 2 });
    expect(months).toEqual(["2026.07", "2026.08", "2026.09"]);
  });

  it("returns nothing when already on the current month", () => {
    expect(monthsToProbe({ lastShipped: "2026.09", current: "2026.09" })).toEqual([]);
  });

  it("rejects invalid labels", () => {
    expect(() => parseDataMonth("2026-09")).toThrow(/YYYY\.MM/);
  });
});

describe("resolveNextDataMonth", () => {
  const tags = ["ch-base-2026.07"];

  it("ships the newest available archive newer than last shipped", async () => {
    const available = vi.fn(async (month: string) => month === "2026.08");
    const result = await resolveNextDataMonth({
      artifactId: "ch-base",
      tags,
      now: new Date("2026-09-09T07:00:00Z"),
      archiveAvailable: available,
    });
    expect(result).toMatchObject({
      skip: false,
      reason: "newer",
      month: "2026.08",
      tag: "ch-base-2026.08",
      lastShipped: "2026.07",
    });
    expect(available).toHaveBeenCalledWith("2026.09");
    expect(available).toHaveBeenCalledWith("2026.08");
  });

  it("prefers the newest of several available archives", async () => {
    const result = await resolveNextDataMonth({
      artifactId: "ch-base",
      tags,
      now: new Date("2026-09-09T07:00:00Z"),
      archiveAvailable: async (month) => month === "2026.08" || month === "2026.09",
    });
    expect(result.month).toBe("2026.09");
    expect(result.skip).toBe(false);
  });

  it("skips when nothing newer exists", async () => {
    const result = await resolveNextDataMonth({
      artifactId: "ch-base",
      tags,
      now: new Date("2026-09-09T07:00:00Z"),
      archiveAvailable: async () => false,
    });
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("up-to-date");
    expect(result.month).toBeUndefined();
  });

  it("skips when the current month is already shipped", async () => {
    const available = vi.fn();
    const result = await resolveNextDataMonth({
      artifactId: "ch-base",
      tags: ["ch-base-2026.09"],
      now: new Date("2026-09-09T07:00:00Z"),
      archiveAvailable: available,
    });
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("up-to-date");
    expect(available).not.toHaveBeenCalled();
  });

  it("picks the newest archive when nothing has shipped yet", async () => {
    const result = await resolveNextDataMonth({
      artifactId: "ch-enriched",
      tags: ["ch-base-2026.07"],
      now: new Date("2026-09-09T07:00:00Z"),
      archiveAvailable: async (month) => month === "2026.08",
    });
    expect(result).toMatchObject({
      skip: false,
      month: "2026.08",
      tag: "ch-enriched-2026.08",
      lastShipped: undefined,
    });
  });

  it("honours a forced month unless that tag already exists", async () => {
    const shipped = await resolveNextDataMonth({
      artifactId: "ch-base",
      tags,
      forcedMonth: "2026.07",
      archiveAvailable: async () => true,
    });
    expect(shipped.reason).toBe("already-shipped");
    expect(shipped.skip).toBe(true);

    const forced = await resolveNextDataMonth({
      artifactId: "ch-base",
      tags,
      forcedMonth: "2026.08",
      archiveAvailable: async () => {
        throw new Error("must not probe when month is forced");
      },
    });
    expect(forced).toMatchObject({ skip: false, reason: "forced", month: "2026.08" });
  });

  it("reads last shipped from official tags", () => {
    expect(lastShippedMonth(["ch-base-2026.07", "ch-base-2026.05", "v1"], "ch-base")).toBe("2026.07");
    expect(lastShippedMonth(["ch-base-2026.07"], "ch-enriched")).toBeUndefined();
  });

  it("forced month works for fr-base without probing Swissmedic", async () => {
    const result = await resolveNextDataMonth({
      artifactId: "fr-base",
      tags: ["fr-base-2026.08"],
      forcedMonth: "2026.09",
      archiveAvailable: async () => {
        throw new Error("must not probe when month is forced");
      },
    });
    expect(result).toMatchObject({ skip: false, reason: "forced", month: "2026.09", tag: "fr-base-2026.09" });
  });

  it("treats a live BDPM dump as available for the current unpublished month", async () => {
    const result = await resolveNextDataMonth({
      artifactId: "fr-base",
      tags: ["fr-base-2026.07"],
      now: new Date("2026-09-09T07:00:00Z"),
      archiveAvailable: async () => true,
    });
    expect(result).toMatchObject({
      skip: false,
      reason: "newer",
      month: "2026.09",
      tag: "fr-base-2026.09",
    });
  });

  it("writes GitHub Actions output fields", () => {
    expect(
      githubOutputLines({
        skip: false,
        reason: "newer",
        artifactId: "ch-base",
        month: "2026.08",
        tag: "ch-base-2026.08",
        lastShipped: "2026.07",
        probed: ["2026.09", "2026.08"],
      }),
    ).toBe(
      ["skip=false", "month=2026.08", "tag=ch-base-2026.08", "last_shipped=2026.07", "reason=newer"].join(
        "\n",
      ),
    );
  });
});

describe("httpExists", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats HEAD 200 as present and 404 as missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => new Response(null, { status: String(url).includes("missing") ? 404 : 200 })),
    );
    expect(await httpExists("https://example.com/OGD_202608.zip")).toBe(true);
    expect(await httpExists("https://example.com/missing.zip")).toBe(false);
  });

  it("falls back to a ranged GET when HEAD is not allowed", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 405 });
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await httpExists("https://example.com/OGD_202608.zip")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on server errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503, statusText: "Unavailable" })));
    await expect(httpExists("https://example.com/OGD.zip")).rejects.toBeInstanceOf(HttpStatusError);
  });
});
