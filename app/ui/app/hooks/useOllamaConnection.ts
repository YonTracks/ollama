"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getVersion } from "@/lib/ollama/client";
import { getStandaloneVersion } from "@/lib/ollama/standalone";
import type { AppMode } from "@/lib/appMode";
import { useOnlineStatus } from "./useOnlineStatus";
import type { ConnectionStatus } from "@/types/app";

export function useOllamaConnection(mode: AppMode, coreApiBase?: string, enabled = true) {
  const online = useOnlineStatus();
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) {
        setStatus("checking");
        setVersion(null);
        setError(null);
        return false;
      }

      setStatus((current) => (current === "connected" ? current : "checking"));

      try {
        const response =
          mode === "standalone"
            ? await getStandaloneVersion(coreApiBase, signal)
            : await getVersion(signal);
        setVersion(response.version);
        setStatus("connected");
        setError(null);
        return true;
      } catch (checkError) {
        const message =
          checkError instanceof Error ? checkError.message : "Ollama is not reachable.";
        setVersion(null);
        setStatus(online ? "disconnected" : "offline");
        setError(
          online
            ? message
            : "No internet connection, and the local Ollama API is not reachable."
        );
        return false;
      }
    },
    [coreApiBase, enabled, mode, online]
  );

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    check(controller.signal);

    const interval = window.setInterval(() => {
      const nextController = new AbortController();
      check(nextController.signal);
    }, 10000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [check, enabled]);

  return useMemo(
    () => ({
      online,
      status,
      version,
      error,
      refresh: check
    }),
    [check, error, online, status, version]
  );
}
