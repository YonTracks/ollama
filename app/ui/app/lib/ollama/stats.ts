import type { OllamaUsageMetrics, ResponseStats } from "./types";

interface ProcessModel {
  model?: string;
  name?: string;
  context_length?: number;
}

export function nsToSeconds(ns?: number): number | null {
  if (typeof ns !== "number" || !Number.isFinite(ns)) return null;
  return ns / 1_000_000_000;
}

export function tokensPerSecond(tokens?: number, durationNs?: number): number | null {
  if (
    typeof tokens !== "number" ||
    typeof durationNs !== "number" ||
    !Number.isFinite(tokens) ||
    !Number.isFinite(durationNs) ||
    durationNs <= 0
  ) {
    return null;
  }

  return tokens / (durationNs / 1_000_000_000);
}

export function buildResponseStats(
  metrics: OllamaUsageMetrics,
  contextLimit: number | null
): ResponseStats {
  const outputTokens =
    typeof metrics.eval_count === "number" ? metrics.eval_count : null;
  const promptTokens =
    typeof metrics.prompt_eval_count === "number" ? metrics.prompt_eval_count : null;
  const contextUsed =
    outputTokens !== null && promptTokens !== null
      ? outputTokens + promptTokens
      : null;

  return {
    outputTokens,
    promptTokens,
    contextUsed,
    contextLimit,
    outputTokensPerSecond: tokensPerSecond(
      metrics.eval_count,
      metrics.eval_duration
    ),
    promptTokensPerSecond: tokensPerSecond(
      metrics.prompt_eval_count,
      metrics.prompt_eval_duration
    ),
    totalSeconds: nsToSeconds(metrics.total_duration),
    loadSeconds: nsToSeconds(metrics.load_duration),
    doneReason: metrics.done_reason,
    raw: metrics
  };
}

export function hasUsageMetrics(metrics: OllamaUsageMetrics) {
  return (
    typeof metrics.total_duration === "number" ||
    typeof metrics.load_duration === "number" ||
    typeof metrics.prompt_eval_count === "number" ||
    typeof metrics.prompt_eval_duration === "number" ||
    typeof metrics.eval_count === "number" ||
    typeof metrics.eval_duration === "number" ||
    Boolean(metrics.done_reason)
  );
}

export function usageMetricsFromChunk(chunk: OllamaUsageMetrics): OllamaUsageMetrics {
  return {
    total_duration: numberOrUndefined(chunk.total_duration),
    load_duration: numberOrUndefined(chunk.load_duration),
    prompt_eval_count: numberOrUndefined(chunk.prompt_eval_count),
    prompt_eval_duration: numberOrUndefined(chunk.prompt_eval_duration),
    eval_count: numberOrUndefined(chunk.eval_count),
    eval_duration: numberOrUndefined(chunk.eval_duration),
    done_reason: typeof chunk.done_reason === "string" ? chunk.done_reason : undefined
  };
}

export async function getOllamaContextLimit(params: {
  baseUrl: string;
  model: string;
  fallbackNumCtx?: number | null;
  signal?: AbortSignal;
}): Promise<number | null> {
  try {
    const res = await fetch(joinApiUrl(params.baseUrl, "/api/ps"), {
      cache: "no-store",
      signal: params.signal
    });

    if (!res.ok) return params.fallbackNumCtx ?? null;

    const data = (await res.json()) as { models?: ProcessModel[] };
    const models = Array.isArray(data.models) ? data.models : [];
    const match = models.find((model) => matchesModel(model, params.model));

    if (typeof match?.context_length === "number") {
      return match.context_length;
    }

    return params.fallbackNumCtx ?? null;
  } catch {
    return params.fallbackNumCtx ?? null;
  }
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function joinApiUrl(baseUrl: string, path: string) {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function matchesModel(processModel: ProcessModel, requested: string) {
  const candidates = [processModel.model, processModel.name]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  return candidates.some((candidate) => {
    return (
      candidate === requested ||
      candidate.startsWith(`${requested}:`) ||
      requested.startsWith(`${candidate}:`) ||
      stripLatest(candidate) === stripLatest(requested)
    );
  });
}

function stripLatest(model: string) {
  return model.replace(/:latest$/, "");
}
