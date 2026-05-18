import { describe, expect, it } from "vitest";
import { resolveWebSearchDecision } from "./mode";
import { shouldSearchPrompt } from "./should-search";

describe("shouldSearchPrompt", () => {
  it("searches for freshness and current-info prompts", () => {
    expect(shouldSearchPrompt("What is the latest Ollama changelog?")).toMatchObject({
      shouldSearch: true,
      reason: "freshness or current-info signal"
    });
    expect(shouldSearchPrompt("Who is the current CEO of Example Corp?").shouldSearch).toBe(
      true
    );
    expect(shouldSearchPrompt("What happened with the GitHub outage today?").shouldSearch).toBe(
      true
    );
  });

  it("searches for docs, provider, and troubleshooting prompts", () => {
    expect(shouldSearchPrompt("According to docs, how does the Tavily API work?")).toMatchObject({
      shouldSearch: true,
      reason: "explicit web lookup requested"
    });
    expect(shouldSearchPrompt("Look up this error message in GitHub issues")).toMatchObject({
      shouldSearch: true
    });
    expect(shouldSearchPrompt("Compare the best web search API providers")).toMatchObject({
      shouldSearch: true
    });
  });

  it("skips local, creative, provided-text, and offline prompts", () => {
    expect(shouldSearchPrompt("Implement this function in app/ui/foo.ts")).toMatchObject({
      shouldSearch: false,
      reason: "local code or project task"
    });
    expect(shouldSearchPrompt("Write a short poem about careful engineering").shouldSearch).toBe(
      false
    );
    expect(shouldSearchPrompt("Summarize the following text only").shouldSearch).toBe(false);
    expect(shouldSearchPrompt("Answer this offline without the internet").shouldSearch).toBe(
      false
    );
  });
});

describe("resolveWebSearchDecision", () => {
  it("keeps off mode from searching", () => {
    expect(
      resolveWebSearchDecision("latest release notes", {
        mode: "off",
        manualEnabled: true
      })
    ).toEqual({
      mode: "off",
      shouldSearch: false,
      reason: "web search mode is off"
    });
  });

  it("uses manual mode only when enabled", () => {
    expect(
      resolveWebSearchDecision("latest release notes", {
        mode: "manual",
        manualEnabled: false
      }).shouldSearch
    ).toBe(false);
    expect(
      resolveWebSearchDecision("local creative prompt", {
        mode: "manual",
        manualEnabled: true
      })
    ).toMatchObject({
      mode: "manual",
      shouldSearch: true,
      reason: "manual web search enabled"
    });
  });

  it("uses auto mode only when the heuristic is positive", () => {
    expect(
      resolveWebSearchDecision("what is the latest React version", {
        mode: "auto",
        manualEnabled: false
      }).shouldSearch
    ).toBe(true);
    expect(
      resolveWebSearchDecision("write a scene in a quiet sci-fi style", {
        mode: "auto",
        manualEnabled: false
      }).shouldSearch
    ).toBe(false);
  });
});
