import { describe, expect, it } from "vitest";
import {
  buildContextWarnings,
  calculateContextBudget,
  estimateMessagesTokens,
  prepareContextMessages
} from "./context";
import type { ChatMessage, OllamaContextSettings } from "./types";

const baseSettings: OllamaContextSettings = {
  mode: "friendly",
  numCtx: 180,
  numPredict: null,
  reserveOutputTokens: 40,
  nearFullThresholdPercent: 85,
  enableAutoSummarize: false,
  enableAutoTrim: true
};

function message(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: `${role}-${content.slice(0, 4)}`, role, content };
}

describe("context budget utilities", () => {
  it("marks near-limit and over-limit states", () => {
    const messages = [message("user", "x".repeat(400))];

    expect(
      calculateContextBudget({
        messages,
        contextLimit: 120,
        outputReserveTokens: 24,
        nearFullThresholdPercent: 80
      })
    ).toMatchObject({
      isNearLimit: true,
      wouldExceedLimit: true
    });
  });

  it("friendly trimming preserves system messages and the latest user message", () => {
    const messages = [
      message("system", "Always answer carefully."),
      message("user", "old ".repeat(220)),
      message("assistant", "old answer ".repeat(220)),
      message("user", "latest question")
    ];

    const prepared = prepareContextMessages({
      messages,
      settings: baseSettings
    });

    expect(prepared.contextNotice.action).toBe("trimmed");
    expect(prepared.messages).toContain(messages[0]);
    expect(prepared.messages).toContain(messages[3]);
    expect(prepared.messages).not.toContain(messages[1]);
  });

  it("friendly trimming drops oldest non-system messages first", () => {
    const messages = [
      message("system", "System prompt."),
      message("user", "first ".repeat(160)),
      message("assistant", "second ".repeat(160)),
      message("user", "third ".repeat(40)),
      message("assistant", "fourth ".repeat(30)),
      message("user", "latest")
    ];

    const prepared = prepareContextMessages({
      messages,
      settings: baseSettings
    });

    expect(prepared.messages).not.toContain(messages[1]);
    expect(prepared.messages).toContain(messages[5]);
    expect(estimateMessagesTokens(prepared.messages)).toBeLessThan(
      estimateMessagesTokens(messages)
    );
  });

  it("detects warning conditions", () => {
    expect(
      buildContextWarnings({
        stats: {
          outputTokens: 50,
          promptTokens: 950,
          contextUsed: 1000,
          contextLimit: 1000,
          contextPercent: 100,
          outputTokensPerSecond: 20,
          promptTokensPerSecond: null,
          totalSeconds: 3,
          loadSeconds: null
        }
      }).map((warning) => warning.kind)
    ).toContain("full");

    expect(
      buildContextWarnings({
        contextNotice: {
          mode: "friendly",
          action: "none",
          estimatedPromptTokensAfter: 2200
        },
        stats: {
          outputTokens: 10,
          promptTokens: 1000,
          contextUsed: 3900,
          contextLimit: 4096,
          contextPercent: 95.2,
          outputTokensPerSecond: 10,
          promptTokensPerSecond: null,
          totalSeconds: 1,
          loadSeconds: null
        }
      }).map((warning) => warning.kind)
    ).toEqual(["near-limit", "possible-truncation"]);

    expect(
      buildContextWarnings({
        contextNotice: {
          mode: "friendly",
          action: "trimmed",
          omittedMessageCount: 3,
          estimatedPromptTokensAfter: 2200
        },
        stats: {
          outputTokens: 10,
          promptTokens: 1000,
          contextUsed: 1010,
          contextLimit: 4096,
          contextPercent: 24.7,
          outputTokensPerSecond: 10,
          promptTokensPerSecond: null,
          totalSeconds: 1,
          loadSeconds: null
        }
      }).map((warning) => warning.kind)
    ).toEqual(["trimmed"]);
  });

  it("does not warn about possible truncation when context use is low", () => {
    expect(
      buildContextWarnings({
        contextNotice: {
          mode: "friendly",
          action: "none",
          estimatedPromptTokensAfter: 2200
        },
        stats: {
          outputTokens: 1349,
          promptTokens: 1302,
          contextUsed: 2651,
          contextLimit: 16384,
          contextPercent: 16.2,
          outputTokensPerSecond: 40.7,
          promptTokensPerSecond: 1162.2,
          totalSeconds: 35.2,
          loadSeconds: 0.2
        }
      })
    ).toEqual([]);
  });
});
