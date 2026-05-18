export type SearchProvider =
  | "off"
  | "brave"
  | "tavily"
  | "exa"
  | "ollama"
  | "custom";

export type WebSearchMode = "off" | "manual" | "auto";

export type SearchResult = {
  title: string;
  url: string;
  content: string;
  source?: string;
  engine?: string;
  score?: number;
  publishedDate?: string;
};

export type SearchResponse = {
  provider: SearchProvider;
  query: string;
  results: SearchResult[];
  error?: string;
  disabled?: boolean;
};

export type SearchHealthResponse = {
  provider: SearchProvider;
  configured: boolean;
  reachable: boolean;
  error: string | null;
};

export interface SearchRequestOptions {
  query: string;
  provider?: SearchProvider;
  count?: number;
  safe?: boolean;
  signal?: AbortSignal;
}

export interface ProviderSearchOptions extends SearchRequestOptions {
  provider: Exclude<SearchProvider, "off">;
  count: number;
  safe: boolean;
}

export class SearchProviderError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "SearchProviderError";
    this.status = status;
  }
}
