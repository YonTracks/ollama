import * as dns from "node:dns/promises";
import * as net from "node:net";

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
  await validateCustomSearchUrl(searchUrl);

  searchUrl.searchParams.set("q", options.query);
  searchUrl.searchParams.set("count", String(options.count));
  searchUrl.searchParams.set("safe", String(options.safe));

  const response = await fetch(searchUrl, {
    headers: {
      Accept: "application/json"
    },
    redirect: "manual",
    signal: options.signal
  });

  if (response.status >= 300 && response.status < 400) {
    throw new SearchProviderError(
      "CUSTOM_SEARCH_ENDPOINT redirected to another URL. Configure the final endpoint directly.",
      400
    );
  }

  if (!response.ok) {
    throw new SearchProviderError(`Custom search returned HTTP ${response.status}.`, 502);
  }

  const payload = await safeJson(response);
  return normalizeCustomResults(payload, options.count);
}

export async function validateCustomSearchUrl(searchUrl: URL) {
  if (!searchUrl.hostname) {
    throw new SearchProviderError("CUSTOM_SEARCH_ENDPOINT must include a host.", 400);
  }
  if (searchUrl.username || searchUrl.password) {
    throw new SearchProviderError("CUSTOM_SEARCH_ENDPOINT must not include credentials.", 400);
  }
  if (allowLocalCustomSearch()) return;

  const host = searchUrl.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) {
      throw localEndpointError("points to a local or private address");
    }
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost") || !host.includes(".")) {
    throw localEndpointError("points to a local or private host");
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw new SearchProviderError(
      `CUSTOM_SEARCH_ENDPOINT host could not be validated: ${String(error)}`,
      400
    );
  }

  if (addresses.some(({ address }) => isBlockedAddress(address))) {
    throw localEndpointError("resolves to a local or private address");
  }
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

function allowLocalCustomSearch() {
  const value = process.env.CUSTOM_SEARCH_ALLOW_LOCAL?.trim().toLowerCase();
  return value === "true" || value === "1";
}

function localEndpointError(reason: string) {
  return new SearchProviderError(
    `CUSTOM_SEARCH_ENDPOINT ${reason}. Set CUSTOM_SEARCH_ALLOW_LOCAL=true only for a trusted local search adapter.`,
    400
  );
}

function isBlockedAddress(address: string) {
  const normalized = address.toLowerCase();
  const family = net.isIP(normalized);
  if (family === 4) return isBlockedIPv4(normalized);
  if (family === 6) return isBlockedIPv6(normalized);
  return true;
}

function isBlockedIPv4(address: string) {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isBlockedIPv6(address: string) {
  if (address === "::" || address === "::1") return true;
  return (
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe80:") ||
    address.startsWith("ff")
  );
}
