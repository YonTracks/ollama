import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { GET as HEALTH_GET } from "./health/route";

describe("GET /api/search", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 400 for a missing query", async () => {
    const response = await GET(new Request("http://app.test/api/search"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing search query.");
  });

  it("returns a disabled response when the provider is off", async () => {
    vi.stubEnv("SEARCH_PROVIDER", "off");

    const response = await GET(new Request("http://app.test/api/search?q=ollama"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      provider: "off",
      query: "ollama",
      results: [],
      disabled: true
    });
  });

  it("proxies and normalizes Brave results without exposing the API key", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "secret-brave-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        expect(url).toContain("https://api.search.brave.com/res/v1/web/search");
        expect(url).toContain("q=ollama");
        expect(init?.headers).toMatchObject({
          "X-Subscription-Token": "secret-brave-key"
        });

        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: "Ollama",
                  url: "https://ollama.com/",
                  description: "Run local models.",
                  profile: { name: "Ollama" }
                }
              ]
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      })
    );

    const response = await GET(
      new Request("http://app.test/api/search?q=ollama&provider=brave")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("secret-brave-key");
    expect(body.results).toEqual([
      {
        title: "Ollama",
        url: "https://ollama.com/",
        content: "Run local models.",
        source: "Ollama",
        engine: "brave"
      }
    ]);
  });

  it("proxies and normalizes Tavily results", async () => {
    vi.stubEnv("TAVILY_API_KEY", "secret-tavily-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer secret-tavily-key"
        });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          query: "ollama",
          max_results: 5,
          search_depth: "basic"
        });

        return new Response(
          JSON.stringify({
            results: [
              {
                title: "Ollama docs",
                url: "https://docs.ollama.com/",
                content: "Local model docs.",
                score: 0.9
              }
            ]
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      })
    );

    const response = await GET(
      new Request("http://app.test/api/search?q=ollama&provider=tavily")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      title: "Ollama docs",
      url: "https://docs.ollama.com/",
      content: "Local model docs.",
      source: "Tavily",
      engine: "tavily",
      score: 0.9
    });
  });

  it("returns a friendly timeout error", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SEARCH_TIMEOUT_MS", "5");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "secret-brave-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          })
      )
    );

    const pending = GET(new Request("http://app.test/api/search?q=ollama&provider=brave"));
    await vi.advanceTimersByTimeAsync(10);
    const response = await pending;
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.error).toBe("Web search timed out.");
  });
});

describe("GET /api/search/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports provider off as configured and reachable", async () => {
    const response = await HEALTH_GET(
      new Request("http://app.test/api/search/health?provider=off")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      provider: "off",
      configured: true,
      reachable: true,
      error: null
    });
  });

  it("reports a missing Brave key without exposing secrets", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");

    const response = await HEALTH_GET(
      new Request("http://app.test/api/search/health?provider=brave")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      provider: "brave",
      configured: false,
      reachable: false
    });
    expect(body.error).toContain("BRAVE_SEARCH_API_KEY");
  });

  it("reports a missing Tavily key", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");

    const response = await HEALTH_GET(
      new Request("http://app.test/api/search/health?provider=tavily")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      provider: "tavily",
      configured: false,
      reachable: false
    });
    expect(body.error).toContain("TAVILY_API_KEY");
  });
});
