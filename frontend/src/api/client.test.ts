import { describe, expect, it, vi, afterEach } from "vitest";
import { api, ApiError } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("calls fetch with /api prefix by default", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    await api.listStatements();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/statements",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
        }),
      })
    );
  });

  it("requests summary-by-payee under /api", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            statementId: 1,
            statementName: "S",
            rows: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    await api.statementPayeeSummary(7);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/statements/7/summary-by-payee",
      expect.anything()
    );
  });

  it("throws ApiError on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("nope", { status: 500, statusText: "Server Error" })
        )
      )
    );
    await expect(api.listPayees()).rejects.toThrow(ApiError);
  });
});
