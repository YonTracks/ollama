import { searchBrave } from "./providers/brave";
import { searchCustom } from "./providers/custom";
import { searchExa } from "./providers/exa";
import { searchOllama } from "./providers/ollama";
import { searchTavily } from "./providers/tavily";
import {
  type SearchHealthResponse,
  SearchProviderError,
  type ProviderSearchOptions,
  type SearchProvider,
  type SearchRequestOptions,
  type SearchResponse
} from "./types";
import { sanitizeSearchResults } from "./sanitize";
export { SearchProviderError };

const DEFAULT_PROVIDER: SearchProvider = "off";
const DEFAULT_RESULT_COUNT = 5;
const MAX_RESULT_COUNT = 20;
const DEFAULT_TIMEOUT_MS = 10_000;
const REQUIRED_PROVIDER_ENV: Record<Exclude<SearchProvider, "off">, string> = {
  brave: "BRAVE_SEARCH_API_KEY",
  tavily: "TAVILY_API_KEY",
  exa: "EXA_API_KEY",
  ollama: "OLLAMA_WEB_SEARCH_API_KEY",
  custom: "CUSTOM_SEARCH_ENDPOINT"
};

export async function search(options: SearchRequestOptions): Promise<SearchResponse> {
  const query = options.query.trim();
  const provider = options.provider ?? configuredProvider();

  if (provider === "off") {
    return {
      provider,
      query,
      results: [],
      disabled: true
    };
  }

  const count = resultCount(options.count);
  const safe = safeMode(options.safe);

  return withTimeout(options.signal, async (signal) => {
    const providerOptions: ProviderSearchOptions = {
      ...options,
      query,
      provider,
      count,
      safe,
      signal
    };

    const results = sanitizeSearchResults(await searchWithProvider(providerOptions), count);
    return {
      provider,
      query,
      results
    };
  });
}

export function configuredProvider(): SearchProvider {
  return providerValue(process.env.SEARCH_PROVIDER) ?? DEFAULT_PROVIDER;
}

export function searchProviderHealth(provider = configuredProvider()): SearchHealthResponse {
  if (provider === "off") {
    return {
      provider,
      configured: true,
      reachable: true,
      error: null
    };
  }

  const envName = REQUIRED_PROVIDER_ENV[provider];
  const value = process.env[envName]?.trim();
  if (!value) {
    return {
      provider,
      configured: false,
      reachable: false,
      error: `Web search provider ${provider} is not configured. Set ${envName}.`
    };
  }

  if (provider === "custom") {
    try {
      const endpoint = new URL(value);
      if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
        return {
          provider,
          configured: false,
          reachable: false,
          error: "CUSTOM_SEARCH_ENDPOINT must use http or https."
        };
      }
    } catch {
      return {
        provider,
        configured: false,
        reachable: false,
        error: "CUSTOM_SEARCH_ENDPOINT is invalid."
      };
    }
  }

  return {
    provider,
    configured: true,
    reachable: false,
    error: null
  };
}

export function providerValue(value: string | null | undefined): SearchProvider | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized === "off" ||
    normalized === "brave" ||
    normalized === "tavily" ||
    normalized === "exa" ||
    normalized === "ollama" ||
    normalized === "custom"
  ) {
    return normalized;
  }
  return "custom";
}

export function resultCount(value?: number) {
  const configured = value ?? integerFromEnv(process.env.SEARCH_RESULT_COUNT);
  if (typeof configured !== "number" || !Number.isFinite(configured)) {
    return DEFAULT_RESULT_COUNT;
  }
  return Math.min(MAX_RESULT_COUNT, Math.max(1, Math.round(configured)));
}

export function safeMode(value?: boolean) {
  if (typeof value === "boolean") return value;
  const configured = process.env.SEARCH_SAFE_MODE?.trim().toLowerCase();
  if (!configured) return true;
  return configured !== "false" && configured !== "0" && configured !== "off";
}

export function timeoutMs() {
  const configured = integerFromEnv(process.env.SEARCH_TIMEOUT_MS);
  if (typeof configured !== "number" || !Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return configured;
}

async function searchWithProvider(options: ProviderSearchOptions) {
  switch (options.provider) {
    case "brave":
      return searchBrave(options);
    case "tavily":
      return searchTavily(options);
    case "exa":
      return searchExa(options);
    case "ollama":
      return searchOllama(options);
    case "custom":
      return searchCustom(options);
  }
}

async function withTimeout<T>(
  signal: AbortSignal | undefined,
  callback: (signal: AbortSignal) => Promise<T>
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());
  const abort = () => controller.abort();

  try {
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    return await callback(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new SearchProviderError("Web search timed out.", 504);
    }
    if (error instanceof TypeError) {
      throw new SearchProviderError(
        "Web search provider is unreachable. Check your connection and provider settings.",
        502
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function integerFromEnv(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
