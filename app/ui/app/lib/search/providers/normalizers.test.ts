import { describe, expect, it } from "vitest";
import { normalizeBraveResults } from "./brave";
import { normalizeCustomResults } from "./custom";
import { normalizeTavilyResults } from "./tavily";

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
});
