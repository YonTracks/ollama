import * as dns from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";

import { SearchProviderError, type ProviderSearchOptions, type SearchResult } from "../types";
import { normalizeSearchResultUrl } from "../sanitize";

type CustomResponse = {
  results?: unknown;
};

type CustomResult = Record<string, unknown>;

type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

const MAX_CUSTOM_SEARCH_RESPONSE_BYTES = 1024 * 1024;
const BLOCKED_ADDRESS_RANGES = new net.BlockList();
BLOCKED_ADDRESS_RANGES.addSubnet("0.0.0.0", 8, "ipv4");
BLOCKED_ADDRESS_RANGES.addSubnet("10.0.0.0", 8, "ipv4");
BLOCKED_ADDRESS_RANGES.addSubnet("127.0.0.0", 8, "ipv4");
BLOCKED_ADDRESS_RANGES.addSubnet("100.64.0.0", 10, "ipv4");
BLOCKED_ADDRESS_RANGES.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED_ADDRESS_RANGES.addSubnet("172.16.0.0", 12, "ipv4");
BLOCKED_ADDRESS_RANGES.addSubnet("192.168.0.0", 16, "ipv4");
BLOCKED_ADDRESS_RANGES.addSubnet("224.0.0.0", 4, "ipv4");
BLOCKED_ADDRESS_RANGES.addSubnet("240.0.0.0", 4, "ipv4");
BLOCKED_ADDRESS_RANGES.addAddress("::", "ipv6");
BLOCKED_ADDRESS_RANGES.addAddress("::1", "ipv6");
BLOCKED_ADDRESS_RANGES.addSubnet("fc00::", 7, "ipv6");
BLOCKED_ADDRESS_RANGES.addSubnet("fe80::", 10, "ipv6");
BLOCKED_ADDRESS_RANGES.addSubnet("ff00::", 8, "ipv6");

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
  const resolvedAddresses = await validateCustomSearchUrl(searchUrl);

  searchUrl.searchParams.set("q", options.query);
  searchUrl.searchParams.set("count", String(options.count));
  searchUrl.searchParams.set("safe", String(options.safe));

  const response = await requestCustomSearch(searchUrl, resolvedAddresses, options.signal);

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
    return [{ address: host, family: net.isIP(host) as 4 | 6 }];
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

  return addresses
    .map(({ address }) => ({ address, family: net.isIP(address) }))
    .filter((target): target is ResolvedAddress => target.family === 4 || target.family === 6);
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
  const normalized = address.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  const family = net.isIP(normalized);
  if (family === 4 || family === 6) {
    return BLOCKED_ADDRESS_RANGES.check(normalized, family === 4 ? "ipv4" : "ipv6");
  }
  return true;
}

async function requestCustomSearch(
  searchUrl: URL,
  resolvedAddresses: ResolvedAddress[] | undefined,
  signal?: AbortSignal
) {
  const request = searchUrl.protocol === "https:" ? https.request : http.request;

  return new Promise<Response>((resolve, reject) => {
    const req = request(
      searchUrl,
      {
        headers: { Accept: "application/json" },
        lookup: resolvedAddresses?.length ? createPinnedLookup(resolvedAddresses) : undefined,
        method: "GET",
        signal
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;

        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_CUSTOM_SEARCH_RESPONSE_BYTES) {
            req.destroy(
              new SearchProviderError("Custom search response is too large.", 502)
            );
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve(
            new Response(body, {
              status: res.statusCode ?? 502,
              statusText: res.statusMessage
            })
          );
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

function createPinnedLookup(addresses: ResolvedAddress[]): http.RequestOptions["lookup"] {
  return ((_hostname, options, callback) => {
    const family =
      typeof options === "object" && options && "family" in options
        ? Number(options.family)
        : 0;
    const candidates =
      family === 4 || family === 6
        ? addresses.filter((address) => address.family === family)
        : addresses;
    const target = candidates[0];

    if (!target) {
      callback(
        Object.assign(new Error("CUSTOM_SEARCH_ENDPOINT host resolved to no addresses."), {
          code: "ENOTFOUND"
        }),
        "",
        0
      );
      return;
    }

    callback(null, target.address, target.family);
  }) as http.RequestOptions["lookup"];
}
