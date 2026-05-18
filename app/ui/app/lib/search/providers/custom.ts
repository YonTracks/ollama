import { SearchProviderError, type ProviderSearchOptions, type SearchResult } from "../types";
import { normalizeSearchResultUrl } from "../sanitize";

type CustomResponse = {
  results?: unknown;
};

type CustomResult = Record<string, unknown>;

export async function searchCustom(options: ProviderSearchOptions) {
  const endpoint = process.env.CUSTOM_SEARCH_ENDPOINT?.trim();
  if (!endpoint) {
    throw new SearchProviderError(
      "Web search is enabled, but CUSTOM_SEARCH_ENDPOINT is missing.",
      400
    );
  }

  const searchUrl = new URL(endpoint);
  if (searchUrl.protocol !== "http:" && searchUrl.protocol !== "https:") {
    throw new SearchProviderError("CUSTOM_SEARCH_ENDPOINT must use http or https.", 400);
  }
  searchUrl.searchParams.set("q", options.query);
  searchUrl.searchParams.set("count", String(options.count));
  searchUrl.searchParams.set("safe", String(options.safe));

  const response = await fetch(searchUrl, {
    headers: {
      Accept: "application/json"
    },
    signal: options.signal
  });

  if (!response.ok) {
    throw new SearchProviderError(`Custom search returned HTTP ${response.status}.`, 502);
  }

  const payload = await safeJson(response);
  return normalizeCustomResults(payload, options.count);
}

export function normalizeCustomResults(payload: unknown, count: number): SearchResult[] {
  const rawResults = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as CustomResponse)?.results)
      ? (payload as CustomResponse).results
      : [];

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const raw of rawResults as CustomResult[]) {
    const url = normalizeSearchResultUrl(firstString(raw.url, raw.link, raw.href));
    if (!url || seen.has(url)) continue;

    const title = firstString(raw.title, raw.name) || url;
    const content = firstString(
      raw.content,
      raw.snippet,
      raw.description,
      raw.text,
      raw.summary
    );
    const score = numberValue(raw.score);
    const publishedDate = firstString(raw.publishedDate, raw.published_date, raw.date);

    results.push({
      title,
      url,
      content,
      source: firstString(raw.source, raw.site),
      engine: firstString(raw.engine) || "custom",
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

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
