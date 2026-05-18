import type { SearchResult } from "./types";

export const MAX_SEARCH_TITLE_LENGTH = 240;
export const MAX_SEARCH_CONTENT_LENGTH = 2_000;
export const MAX_SEARCH_SOURCE_LENGTH = 120;
export const MAX_SEARCH_DATE_LENGTH = 80;

const ALLOWED_SEARCH_URL_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeSearchResultUrl(value: unknown) {
  if (typeof value !== "string") return "";

  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (!ALLOWED_SEARCH_URL_PROTOCOLS.has(url.protocol) || !url.hostname) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function truncateSearchText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function sanitizeSearchResult(result: SearchResult): SearchResult | null {
  const url = normalizeSearchResultUrl(result.url);
  if (!url) return null;

  const score =
    typeof result.score === "number" && Number.isFinite(result.score)
      ? result.score
      : undefined;
  const publishedDate = truncateSearchText(result.publishedDate, MAX_SEARCH_DATE_LENGTH);

  return {
    title: truncateSearchText(result.title, MAX_SEARCH_TITLE_LENGTH) || url,
    url,
    content: truncateSearchText(result.content, MAX_SEARCH_CONTENT_LENGTH),
    source: truncateSearchText(result.source, MAX_SEARCH_SOURCE_LENGTH) || undefined,
    engine: truncateSearchText(result.engine, MAX_SEARCH_SOURCE_LENGTH) || undefined,
    ...(typeof score === "number" ? { score } : {}),
    ...(publishedDate ? { publishedDate } : {})
  };
}

export function sanitizeSearchResults(results: SearchResult[], count = results.length) {
  const sanitized: SearchResult[] = [];
  const seen = new Set<string>();
  const limit = Math.max(0, count);

  for (const result of results) {
    const next = sanitizeSearchResult(result);
    if (!next || seen.has(next.url)) continue;

    sanitized.push(next);
    seen.add(next.url);
    if (sanitized.length >= limit) break;
  }

  return sanitized;
}
