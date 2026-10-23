import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceDirFor } from "../src/adapters/descriptor.js";
import { TERMS_PAGE_HEADERS, checkTerms } from "../src/pipeline/terms.js";
import { HttpStatusError, fetchBinary, fetchText } from "../src/security.js";

describe("fetchBinary retries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries HTTP 415 then returns the body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 415, statusText: "Unsupported Media Type" }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const buf = await fetchBinary("https://example.com/terms", { retryDelayMs: 0 });
    expect(buf.toString("utf8")).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry HTTP 404", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404, statusText: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchBinary("https://example.com/missing", { retryDelayMs: 0 })).rejects.toBeInstanceOf(
      HttpStatusError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes a windows-1256 page per the charset label", async () => {
    const body = new Uint8Array([
      ...new TextEncoder().encode("<html>"),
      0xC7, 0xE1, 0xDA, 0xC7, 0xE1, 0xE3, // "العالم" in windows-1256
      ...new TextEncoder().encode("</html>"),
    ]);
    const fetchMock = vi.fn(
      async () => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=windows-1256" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const text = await fetchText("https://example.com/page");
    expect(text).toContain("العالم");
  });

  it("strips a utf-8 BOM and defaults to utf-8 without a charset label", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("<html></html>")]), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const text = await fetchText("https://example.com/bom");
    expect(text.startsWith("\uFEFF")).toBe(false);
    expect(text).toBe("<html></html>");
  });

  it("defaults to utf-8 when no charset is declared", async () => {
    const fetchMock = vi.fn(async () => new Response("plain", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchText("https://example.com/plain")).toBe("plain");
  });
});

describe("terms page fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests HTML with an explicit Accept-Language", async () => {
    const fetchMock = vi.fn(async () => new Response("<html></html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const dir = sourceDirFor("refdata");
    expect(dir).toBeTruthy();
    await checkTerms(dir!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Accept")).toBe(TERMS_PAGE_HEADERS.Accept);
    expect(headers.get("Accept-Language")).toBe(TERMS_PAGE_HEADERS["Accept-Language"]);
  });

  it("retries a WAF 401 before recording a fetch error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401, statusText: "Unauthorized" }))
      .mockResolvedValueOnce(new Response(null, { status: 401, statusText: "Unauthorized" }))
      .mockResolvedValueOnce(new Response("<html></html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const dir = sourceDirFor("refdata");
    const status = await checkTerms(dir!, { retryDelayMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(status.fetchError).toBeUndefined();
    expect(status.currentChecksum).toBeTruthy();
  });

  it("records the fetch error after exhausting retries", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401, statusText: "Unauthorized" }));
    vi.stubGlobal("fetch", fetchMock);
    const dir = sourceDirFor("refdata");
    const status = await checkTerms(dir!, { retryDelayMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(status.fetchError).toMatch(/401/);
    expect(status.changed).toBe(false);
  });
});
