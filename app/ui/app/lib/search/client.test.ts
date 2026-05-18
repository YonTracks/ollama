import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSearchHealth, fetchSearchResults } from "./client";

describe("search client helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a friendly error response instead of throwing when search fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            provider: "brave",
            query: "latest docs",
            results: [],
            error: "Web search provider is unreachable."
          }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(fetchSearchResults("latest docs", { provider: "brave" })).resolves.toEqual({
      provider: "brave",
      query: "latest docs",
      disabled: false,
      results: [],
      error: "Web search provider is unreachable."
    });
  });

  it("reads provider health without exposing configuration details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            provider: "off",
            configured: true,
            reachable: true,
            error: null
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(fetchSearchHealth("off")).resolves.toEqual({
      provider: "off",
      configured: true,
      reachable: true,
      error: null
    });
  });
});
