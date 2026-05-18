import { SearchProviderError, type ProviderSearchOptions, type SearchResult } from "../types";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

type BraveResult = {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  extra_snippets?: unknown;
  age?: unknown;
  page_age?: unknown;
  profile?: { name?: unknown };
};

type BraveResponse = {
  web?: {
    results?: unknown;
  };
};

export async function searchBrave(options: ProviderSearchOptions) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!apiKey) {
    throw new SearchProviderError(
      "Web search is enabled, but BRAVE_SEARCH_API_KEY is missing.",
      400
    );
  }

  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", options.query);
  url.searchParams.set("count", String(options.count));
  url.searchParams.set("safesearch", options.safe ? "moderate" : "off");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey
    },
    signal: options.signal
  });

  if (!response.ok) {
    throw new SearchProviderError(`Brave Search returned HTTP ${response.status}.`, 502);
  }

  const payload = await safeJson(response);
  return normalizeBraveResults(payload, options.count);
}

export function normalizeBraveResults(payload: unknown, count: number): SearchResult[] {
  const data = payload as BraveResponse;
  if (!Array.isArray(data?.web?.results)) return [];

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const raw of data.web.results as BraveResult[]) {
    const url = stringValue(raw.url);
    if (!url || seen.has(url)) continue;

    const snippets = Array.isArray(raw.extra_snippets)
      ? raw.extra_snippets.map((value) => stringValue(value)).filter(Boolean)
      : [];
    const content = [stringValue(raw.description), ...snippets].filter(Boolean).join("\n");
    const title = stringValue(raw.title) || url;
    const source = stringValue(raw.profile?.name);
    const publishedDate = stringValue(raw.page_age) || stringValue(raw.age);

    results.push({
      title,
      url,
      content,
      source: source || "Brave Search",
      engine: "brave",
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
