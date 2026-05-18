import { shouldSearchPrompt } from "./should-search";
import type { WebSearchMode } from "./types";

export type WebSearchDecision = {
  mode: WebSearchMode;
  shouldSearch: boolean;
  reason: string;
};

export function resolveWebSearchDecision(
  input: string,
  options: {
    mode: WebSearchMode;
    manualEnabled: boolean;
  }
): WebSearchDecision {
  if (!input.trim()) {
    return {
      mode: options.mode,
      shouldSearch: false,
      reason: "empty prompt"
    };
  }

  if (options.mode === "off") {
    return {
      mode: "off",
      shouldSearch: false,
      reason: "web search mode is off"
    };
  }

  if (options.mode === "manual") {
    return {
      mode: "manual",
      shouldSearch: options.manualEnabled,
      reason: options.manualEnabled
        ? "manual web search enabled"
        : "manual web search was not enabled for this message"
    };
  }

  const autoDecision = shouldSearchPrompt(input);
  return {
    mode: "auto",
    shouldSearch: autoDecision.shouldSearch,
    reason: autoDecision.reason
  };
}
