"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export const SENSITIVE_CACHE_QUERY_PARAMS = [
  "ollama_token",
  "token",
  "access_token",
  "api_key",
  "apikey",
  "authorization"
];

export interface CacheDiagnosticEntry {
  cacheName: string;
  url: string;
}

export interface CacheDiagnosticsSummary {
  cacheNames: string[];
  entryCount: number;
  apiEntryCount: number;
  sensitiveEntryCount: number;
  sensitiveEntries: string[];
}

export interface PwaCacheDiagnostics extends CacheDiagnosticsSummary {
  supported: boolean;
  serviceWorkerSupported: boolean;
  registered: boolean;
  registrationCount: number;
  loading: boolean;
  error: string | null;
}

const initialSummary: CacheDiagnosticsSummary = {
  cacheNames: [],
  entryCount: 0,
  apiEntryCount: 0,
  sensitiveEntryCount: 0,
  sensitiveEntries: []
};

export const initialCacheDiagnostics: PwaCacheDiagnostics = {
  ...initialSummary,
  supported: false,
  serviceWorkerSupported: false,
  registered: false,
  registrationCount: 0,
  loading: false,
  error: null
};

export function usePwaCacheDiagnostics(enabled = true) {
  const [state, setState] = useState<PwaCacheDiagnostics>(initialCacheDiagnostics);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    const cacheSupported = typeof caches !== "undefined";
    const serviceWorkerSupported = typeof navigator !== "undefined" && "serviceWorker" in navigator;

    if (!cacheSupported) {
      setState({
        ...initialCacheDiagnostics,
        serviceWorkerSupported,
        error: "Cache Storage is not available."
      });
      return;
    }

    setState((current) => ({
      ...current,
      supported: true,
      serviceWorkerSupported,
      loading: true,
      error: null
    }));

    try {
      const registrationCount = serviceWorkerSupported
        ? (await navigator.serviceWorker.getRegistrations()).length
        : 0;
      const cacheNames = await caches.keys();
      const entries: CacheDiagnosticEntry[] = [];

      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        for (const request of requests) {
          entries.push({ cacheName, url: request.url });
        }
      }

      setState({
        ...summarizeCacheEntries(entries),
        cacheNames,
        supported: true,
        serviceWorkerSupported,
        registered: registrationCount > 0,
        registrationCount,
        loading: false,
        error: null
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Cache diagnostics failed."
      }));
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return useMemo(
    () => ({
      ...state,
      refresh
    }),
    [refresh, state]
  );
}

export function summarizeCacheEntries(entries: CacheDiagnosticEntry[]): CacheDiagnosticsSummary {
  const cacheNames = Array.from(new Set(entries.map((entry) => entry.cacheName)));
  const sensitiveEntries: string[] = [];
  let apiEntryCount = 0;

  for (const entry of entries) {
    const inspection = inspectCacheRequestUrl(entry.url);
    if (inspection.api) apiEntryCount += 1;
    if (inspection.sensitive) sensitiveEntries.push(entry.url);
  }

  return {
    cacheNames,
    entryCount: entries.length,
    apiEntryCount,
    sensitiveEntryCount: sensitiveEntries.length,
    sensitiveEntries
  };
}

export function inspectCacheRequestUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl, "http://localhost");
    return {
      api: isApiRequest(url),
      sensitive: SENSITIVE_CACHE_QUERY_PARAMS.some((param) => url.searchParams.has(param))
    };
  } catch {
    return { api: true, sensitive: true };
  }
}

function isApiRequest(url: URL) {
  return url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname.includes("/api/");
}
