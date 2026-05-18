import { describe, expect, it } from "vitest";
import { webSearchQueryForPrompt } from "./query";

describe("webSearchQueryForPrompt", () => {
  it("carries the previous user topic into generic search follow-ups", () => {
    expect(
      webSearchQueryForPrompt("search the latest version", [
        { role: "user", content: "what is the latest next.js version" },
        { role: "assistant", content: "Check official sources." }
      ])
    ).toBe("what is the latest next.js version search the latest version");
  });

  it("leaves specific search prompts unchanged", () => {
    expect(
      webSearchQueryForPrompt("search the latest Next.js version", [
        { role: "user", content: "what is the latest ollama version" }
      ])
    ).toBe("search the latest Next.js version");
  });
});
