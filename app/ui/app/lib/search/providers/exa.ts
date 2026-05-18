import { SearchProviderError, type ProviderSearchOptions, type SearchResult } from "../types";

const EXA_ENDPOINT = "https://api.exa.ai/search";

type ExaResult = {
  title?: unknown;
  url?: unknown;
  text?: unknown;
  highlights?: unknown;
  score?: unknown;
  publishedDate?: unknown;
  author?: unknown;
};

type ExaResponse = {
  results?: unknown;
};

export async function searchExa(options: ProviderSearchOptions) {
  const apiKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) {
    throw new SearchProviderError("Web search is enabled, but EXA_API_KEY is missing.", 400);
  }

  const response = await fetch(EXA_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": apiKey
    },
    body: JSON.stringify({
      query: options.query,
      numResults: options.count,
      type: "auto",
      contents: {
        highlights: true
      }
    }),
    signal: options.signal
  });

  if (!response.ok) {
    throw new SearchProviderError(`Exa returned HTTP ${response.status}.`, 502);
  }

  const payload = await safeJson(response);
  return normalizeExaResults(payload, options.count);
}

export function normalizeExaResults(payload: unknown, count: number): SearchResult[] {
  const data = payload as ExaResponse;
  if (!Array.isArray(data?.results)) return [];

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const raw of data.results as ExaResult[]) {
    const url = stringValue(raw.url);
    if (!url || seen.has(url)) continue;

    const highlights = Array.isArray(raw.highlights)
      ? raw.highlights.map((value) => stringValue(value)).filter(Boolean)
      : [];
    const content = highlights.join("\n") || stringValue(raw.text);
    const title = stringValue(raw.title) || url;
    const score = numberValue(raw.score);
    const publishedDate = stringValue(raw.publishedDate);
    const author = stringValue(raw.author);

    results.push({
      title,
      url,
      content,
      source: author || "Exa",
      engine: "exa",
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
