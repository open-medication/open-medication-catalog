import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceDirFor } from "../src/adapters/descriptor.js";
import { TERMS_PAGE_HEADERS, checkTerms } from "../src/pipeline/terms.js";
import { HttpStatusError, fetchBinary } from "../src/security.js";

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
});
