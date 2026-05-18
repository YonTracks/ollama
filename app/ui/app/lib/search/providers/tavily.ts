import { SearchProviderError, type ProviderSearchOptions, type SearchResult } from "../types";
import { normalizeSearchResultUrl } from "../sanitize";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

type TavilyResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
  published_date?: unknown;
};

type TavilyResponse = {
  results?: unknown;
};

export async function searchTavily(options: ProviderSearchOptions) {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new SearchProviderError(
      "Web search is enabled, but TAVILY_API_KEY is missing.",
      400
    );
  }

  const response = await fetch(TAVILY_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: options.query,
      max_results: options.count,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      safe_search: options.safe
    }),
    signal: options.signal
  });

  if (!response.ok) {
    throw new SearchProviderError(`Tavily returned HTTP ${response.status}.`, 502);
  }

  const payload = await safeJson(response);
  return normalizeTavilyResults(payload, options.count);
}

export function normalizeTavilyResults(payload: unknown, count: number): SearchResult[] {
  const data = payload as TavilyResponse;
  if (!Array.isArray(data?.results)) return [];

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const raw of data.results as TavilyResult[]) {
    const url = normalizeSearchResultUrl(raw.url);
    if (!url || seen.has(url)) continue;

    const title = stringValue(raw.title) || url;
    const content = stringValue(raw.content);
    const score = numberValue(raw.score);
    const publishedDate = stringValue(raw.published_date);

    results.push({
      title,
      url,
      content,
      source: "Tavily",
      engine: "tavily",
      ...(typeof score === "number" ? { score } : {}),
      ...(publishedDate ? { publishedDate } : {})
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

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
