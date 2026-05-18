import { describe, expect, it } from "vitest";
import {
  buildContextWarnings,
  calculateContextBudget,
  estimateMessagesTokens,
  normalizeContextSettings,
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
  enableAutoTrim: true,
  enableRetrieval: false,
  retrievalScope: "current",
  retrievalChatIds: [],
  retrievalExcludedChatIds: [],
  retrievalLimit: 4,
  expertMode: false,
  expertInstructions: ""
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

  it("injects web search context as a synthetic system message", () => {
    const prepared = prepareContextMessages({
      messages: [message("user", "What changed in Ollama?")],
      settings: {
        ...baseSettings,
        webSearchContext:
          "Web search results:\n1. Ollama release notes\nURL: https://example.test/ollama\nSnippet: Release details."
      }
    });

    expect(prepared.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("Web search results:")
    });
    expect(prepared.messages[0].content).toContain("https://example.test/ollama");
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

  it("friendly summarization replaces omitted messages with a compact summary", () => {
    const messages = [
      message("system", "Always answer carefully."),
      message("user", `old user topic ${"alpha ".repeat(120)}`),
      message("assistant", `old assistant answer ${"beta ".repeat(120)}`),
      message("user", "latest question")
    ];

    const prepared = prepareContextMessages({
      messages,
      settings: {
        ...baseSettings,
        numCtx: 260,
        enableAutoSummarize: true
      }
    });
    const summary = prepared.messages.find(
      (preparedMessage) =>
        preparedMessage.role === "system" &&
        preparedMessage.content.startsWith("Summary of earlier omitted conversation:")
    );

    expect(prepared.contextNotice.action).toBe("summarized");
    expect(summary?.content).toContain("old user topic");
    expect(summary?.content).toContain("old assistant answer");
    expect(prepared.messages).toContain(messages[0]);
    expect(prepared.messages).toContain(messages[3]);
    expect(prepared.messages).not.toContain(messages[1]);
    expect(estimateMessagesTokens(prepared.messages)).toBeLessThanOrEqual(220);
  });

  it("retrieves relevant older messages into context memory", () => {
    const messages = [
      message("system", "Always answer carefully."),
      message("user", "The customer escalation policy says gold accounts need same-day review."),
      message("assistant", "Gold account escalations should be reviewed before end of day."),
      message("user", "We also discussed dashboard colors."),
      message("assistant", "The dashboard should use restrained colors."),
      message("user", "What should I do for a gold account escalation?")
    ];

    const prepared = prepareContextMessages({
      messages,
      settings: {
        ...baseSettings,
        enableRetrieval: true,
        retrievalLimit: 2
      }
    });
    const memory = prepared.messages.find(
      (preparedMessage) =>
        preparedMessage.role === "system" &&
        preparedMessage.content.startsWith("Relevant retrieved conversation memory:")
    );

    expect(prepared.contextNotice.retrievedMemoryCount).toBeGreaterThan(0);
    expect(memory?.content).toContain("gold accounts");
    expect(memory?.content).not.toContain("dashboard colors");
    expect(
      buildContextWarnings({ contextNotice: prepared.contextNotice }).map(
        (warning) => warning.kind
      )
    ).toContain("retrieved");
  });

  it("boosts remembered name snippets", () => {
    const messages = [
      message("user", "We talked about dashboard colors."),
      message("assistant", "Use restrained colors."),
      message("user", "My name is Joe Citizen."),
      message("assistant", "Nice to meet you, Joe Citizen."),
      message("user", "What is my name?")
    ];

    const prepared = prepareContextMessages({
      messages,
      settings: {
        ...baseSettings,
        enableRetrieval: true,
        retrievalLimit: 1
      }
    });
    const memory = prepared.messages.find(
      (preparedMessage) =>
        preparedMessage.role === "system" &&
        preparedMessage.content.startsWith("Relevant retrieved conversation memory:")
    );

    expect(memory?.content).toContain("My name is Joe Citizen");
    expect(memory?.content).toContain("answer from this memory");
  });

  it("normalizes retrieval memory scope", () => {
    expect(normalizeContextSettings({ retrievalScope: "all" }).retrievalScope).toBe("all");
    expect(normalizeContextSettings({ retrievalScope: "selected" }).retrievalScope).toBe(
      "selected"
    );
    expect(normalizeContextSettings({ retrievalScope: "current" }).retrievalScope).toBe("current");
    expect(
      normalizeContextSettings({ retrievalScope: "unknown" as "current" }).retrievalScope
    ).toBe("current");
    expect(
      normalizeContextSettings({ retrievalChatIds: [" chat-a ", "chat-a", "chat-b"] })
        .retrievalChatIds
    ).toEqual(["chat-a", "chat-b"]);
    expect(
      normalizeContextSettings({
        retrievalExcludedChatIds: [" sensitive-a ", "sensitive-a", "sensitive-b"]
      }).retrievalExcludedChatIds
    ).toEqual(["sensitive-a", "sensitive-b"]);
  });

  it("adds expert instructions as request-only system context", () => {
    const messages = [message("user", "Diagnose this build failure.")];

    const prepared = prepareContextMessages({
      messages,
      settings: {
        ...baseSettings,
        expertMode: true,
        expertInstructions: "Answer like a senior release engineer."
      }
    });

    expect(prepared.contextNotice.expertMode).toBe(true);
    expect(prepared.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("senior release engineer")
    });
    expect(prepared.messages).toContain(messages[0]);
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
