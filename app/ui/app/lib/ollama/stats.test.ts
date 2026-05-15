import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildResponseStats,
  getOllamaContextLimit,
  nsToSeconds,
  tokensPerSecond
} from "./stats";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Ollama response stats", () => {
  it("converts nanoseconds to seconds", () => {
    expect(nsToSeconds(1_000_000_000)).toBe(1);
    expect(nsToSeconds(undefined)).toBeNull();
  });

  it("computes tokens per second safely", () => {
    expect(tokensPerSecond(50, 1_000_000_000)).toBe(50);
    expect(tokensPerSecond(50, 0)).toBeNull();
    expect(tokensPerSecond(undefined, 1_000_000_000)).toBeNull();
  });

  it("builds response stats with context usage", () => {
    expect(
      buildResponseStats(
        {
          total_duration: 2_000_000_000,
          load_duration: 100_000_000,
          prompt_eval_count: 40,
          prompt_eval_duration: 1_000_000_000,
          eval_count: 60,
          eval_duration: 2_000_000_000,
          done_reason: "stop"
        },
        4096
      )
    ).toMatchObject({
      outputTokens: 60,
      promptTokens: 40,
      contextUsed: 100,
      contextLimit: 4096,
      outputTokensPerSecond: 30,
      promptTokensPerSecond: 40,
      totalSeconds: 2,
      loadSeconds: 0.1,
      doneReason: "stop"
    });
  });

  it("returns null fields when metrics are missing", () => {
    expect(buildResponseStats({}, null)).toMatchObject({
      outputTokens: null,
      promptTokens: null,
      contextUsed: null,
      contextLimit: null,
      outputTokensPerSecond: null,
      promptTokensPerSecond: null,
      totalSeconds: null,
      loadSeconds: null
    });
  });

  it("reads the running model context length from /api/ps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              models: [{ model: "llama3.2:latest", context_length: 32768 }]
            }),
            { status: 200 }
          )
        )
      )
    );

    await expect(
      getOllamaContextLimit({
        baseUrl: "http://127.0.0.1:11434",
        model: "llama3.2",
        fallbackNumCtx: 4096
      })
    ).resolves.toBe(32768);
  });
});
