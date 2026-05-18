import { SearchProviderError, type ProviderSearchOptions, type SearchResult } from "../types";
import { normalizeSearchResultUrl } from "../sanitize";

const OLLAMA_WEB_SEARCH_ENDPOINT = "https://ollama.com/api/web_search";

type OllamaSearchResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
};

type OllamaSearchResponse = {
  results?: unknown;
};

export async function searchOllama(options: ProviderSearchOptions) {
  const apiKey = process.env.OLLAMA_WEB_SEARCH_API_KEY?.trim();
  if (!apiKey) {
    throw new SearchProviderError(
      "Web search is enabled, but OLLAMA_WEB_SEARCH_API_KEY is missing.",
      400
    );
  }

  const response = await fetch(OLLAMA_WEB_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: options.query,
      max_results: Math.min(options.count, 10)
    }),
    signal: options.signal
  });

  if (!response.ok) {
    throw new SearchProviderError(`Ollama web search returned HTTP ${response.status}.`, 502);
  }

  const payload = await safeJson(response);
  return normalizeOllamaResults(payload, options.count);
}

export function normalizeOllamaResults(payload: unknown, count: number): SearchResult[] {
  const data = payload as OllamaSearchResponse;
  if (!Array.isArray(data?.results)) return [];

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const raw of data.results as OllamaSearchResult[]) {
    const url = normalizeSearchResultUrl(raw.url);
    if (!url || seen.has(url)) continue;

    results.push({
      title: stringValue(raw.title) || url,
      url,
      content: stringValue(raw.content),
      source: "Ollama web search",
      engine: "ollama"
    });
    seen.add(url);

    if (results.length >= count) break;
  }

  return results;
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
