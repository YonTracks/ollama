"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listModels } from "@/lib/ollama/client";
import { listStandaloneModels } from "@/lib/ollama/standalone";
import type { AppMode } from "@/lib/appMode";
import type { OllamaModel } from "@/lib/ollama/types";

const SUGGESTED_MODELS: OllamaModel[] = [
  { name: "llama3.2", displayName: "llama3.2", local: false },
  { name: "gemma3:4b", displayName: "gemma3:4b", local: false },
  { name: "qwen3:4b", displayName: "qwen3:4b", local: false },
  { name: "gpt-oss:20b", displayName: "gpt-oss:20b", local: false }
];

export function useModels(enabled: boolean, mode: AppMode, coreApiBase?: string) {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) return;
      setLoading(true);
      setError(null);

      try {
        const nextModels =
          mode === "standalone"
            ? await listStandaloneModels(coreApiBase, signal)
            : await listModels(signal);
        setModels(nextModels);
      } catch (refreshError) {
        const message =
          refreshError instanceof Error ? refreshError.message : "Failed to load models";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [coreApiBase, enabled, mode]
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    refresh(controller.signal);

    const interval = window.setInterval(() => {
      const nextController = new AbortController();
      refresh(nextController.signal);
    }, 30000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [enabled, refresh]);

  const allModels = useMemo(() => {
    if (mode === "standalone") return models;

    const seen = new Set(models.map((model) => model.name));
    return [...models, ...SUGGESTED_MODELS.filter((model) => !seen.has(model.name))];
  }, [mode, models]);

  return {
    models: allModels,
    localModels: models,
    loading,
    error,
    refresh
  };
}
