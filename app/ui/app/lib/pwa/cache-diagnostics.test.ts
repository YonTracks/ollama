import { describe, expect, it } from "vitest";
import { inspectCacheRequestUrl, summarizeCacheEntries } from "./cache-diagnostics";

describe("cache diagnostics", () => {
  it("flags API cache entries and token-bearing URLs", () => {
    expect(inspectCacheRequestUrl("https://app.test/api/tags")).toEqual({
      api: true,
      sensitive: false
    });
    expect(inspectCacheRequestUrl("https://app.test/?ollama_token=secret")).toEqual({
      api: false,
      sensitive: true
    });
  });

  it("summarizes cache entries across cache names", () => {
    expect(
      summarizeCacheEntries([
        { cacheName: "ollama-app-shell-v8:static", url: "https://app.test/" },
        { cacheName: "ollama-app-shell-v8:static", url: "https://app.test/api/chat" },
        { cacheName: "runtime", url: "https://app.test/settings/?access_token=secret" }
      ])
    ).toEqual({
      cacheNames: ["ollama-app-shell-v8:static", "runtime"],
      entryCount: 3,
      apiEntryCount: 1,
      sensitiveEntryCount: 1,
      sensitiveEntries: ["https://app.test/settings/?access_token=secret"]
    });
  });
});
