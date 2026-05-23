import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeBraveResults } from "./brave";
import { normalizeCustomResults, searchCustom, validateCustomSearchUrl } from "./custom";
import { normalizeTavilyResults } from "./tavily";

afterEach(() => {
  delete process.env.CUSTOM_SEARCH_ALLOW_LOCAL;
  delete process.env.CUSTOM_SEARCH_ENDPOINT;
  vi.unstubAllGlobals();
});

describe("search result normalizers", () => {
  it("normalizes Brave web results", () => {
    expect(
      normalizeBraveResults(
        {
          web: {
            results: [
              {
                title: "Ollama",
                url: "https://ollama.com/",
                description: "Run local models.",
                extra_snippets: ["Open models."],
                profile: { name: "Ollama" }
              }
            ]
          }
        },
        5
      )
    ).toEqual([
      {
        title: "Ollama",
        url: "https://ollama.com/",
        content: "Run local models.\nOpen models.",
        source: "Ollama",
        engine: "brave"
      }
    ]);
  });

  it("normalizes Tavily results", () => {
    expect(
      normalizeTavilyResults(
        {
          results: [
            {
              title: "Docs",
              url: "https://docs.ollama.com/",
              content: "Documentation.",
              score: 0.8
            }
          ]
        },
        5
      )
    ).toEqual([
      {
        title: "Docs",
        url: "https://docs.ollama.com/",
        content: "Documentation.",
        source: "Tavily",
        engine: "tavily",
        score: 0.8
      }
    ]);
  });

  it("normalizes custom arrays and result envelopes", () => {
    expect(
      normalizeCustomResults(
        {
          results: [
            {
              name: "Custom",
              link: "https://example.test/",
              snippet: "Snippet",
              engine: "local"
            }
          ]
        },
        5
      )
    ).toEqual([
      {
        title: "Custom",
        url: "https://example.test/",
        content: "Snippet",
        source: "",
        engine: "local"
      }
    ]);
  });

  it("drops non-http search result URLs", () => {
    expect(
      normalizeCustomResults(
        [
          { title: "Bad", url: "javascript:alert(1)", snippet: "Nope" },
          { title: "Good", url: "https://example.test/good", snippet: "Yep" }
        ],
        5
      )
    ).toEqual([
      {
        title: "Good",
        url: "https://example.test/good",
        content: "Yep",
        source: "",
        engine: "custom"
      }
    ]);
  });

  it("blocks custom search endpoints on local addresses by default", async () => {
    delete process.env.CUSTOM_SEARCH_ALLOW_LOCAL;
    await expect(validateCustomSearchUrl(new URL("http://127.0.0.1:9999/search"))).rejects.toThrow(
      /CUSTOM_SEARCH_ENDPOINT/
    );
  });

  it("allows local custom search endpoints only with the explicit override", async () => {
    process.env.CUSTOM_SEARCH_ALLOW_LOCAL = "true";
    await expect(
      validateCustomSearchUrl(new URL("http://127.0.0.1:9999/search"))
    ).resolves.toBeUndefined();
  });

  it("does not follow custom search redirects", async () => {
    process.env.CUSTOM_SEARCH_ENDPOINT = "http://93.184.216.34/search";
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1:9999/search" }
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchCustom({ provider: "custom", query: "ollama", count: 3, safe: true })
    ).rejects.toThrow(/redirected/);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: "manual" })
    );
  });
});
