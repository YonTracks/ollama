import { describe, expect, it } from "vitest";
import { getSettingsStorageKey, normalizeSettingsForMode } from "./useLocalSettings";
import type { LocalSettings } from "@/types/app";

describe("local settings mode boundaries", () => {
  it("keeps desktop and standalone settings in separate storage keys", () => {
    expect(getSettingsStorageKey("desktop")).toBe("ollama.app.settings.v1");
    expect(getSettingsStorageKey("standalone")).toBe("ollama.app.standalone.settings.v1");
    expect(getSettingsStorageKey("desktop")).not.toBe(getSettingsStorageKey("standalone"));
  });

  it("strips desktop-only settings and cross-chat memory scope in standalone mode", () => {
    const settings = normalizeSettingsForMode(
      {
        ...baseSettings(),
        expose: true,
        browser: true,
        models: "llama3.2",
        agent: true,
        tools: true,
        workingDir: "C:\\Users\\clint",
        retrievalScope: "all",
        retrievalChatIds: ["chat-a"],
        retrievalExcludedChatIds: ["chat-b"]
      },
      "standalone"
    );

    expect(settings).toMatchObject({
      expose: false,
      browser: false,
      models: "",
      agent: false,
      tools: false,
      workingDir: "",
      retrievalScope: "current",
      retrievalChatIds: [],
      retrievalExcludedChatIds: []
    });
  });

  it("keeps the core API token standalone-only", () => {
    expect(
      normalizeSettingsForMode(
        {
          ...baseSettings(),
          coreApiToken: "test-token"
        },
        "standalone"
      ).coreApiToken
    ).toBe("test-token");

    expect(
      normalizeSettingsForMode(
        {
          ...baseSettings(),
          coreApiToken: "test-token"
        },
        "desktop"
      ).coreApiToken
    ).toBe("");
  });

  it("keeps desktop memory scope local to the desktop settings store", () => {
    const settings = normalizeSettingsForMode(
      {
        ...baseSettings(),
        retrievalScope: "selected",
        retrievalChatIds: ["chat-a", "chat-a", "chat-b"],
        retrievalExcludedChatIds: ["chat-c"]
      },
      "desktop"
    );

    expect(settings.retrievalScope).toBe("selected");
    expect(settings.retrievalChatIds).toEqual(["chat-a", "chat-b"]);
    expect(settings.retrievalExcludedChatIds).toEqual(["chat-c"]);
  });
});

function baseSettings(): LocalSettings {
  return {
    selectedModel: "",
    coreApiBase: "",
    coreApiToken: "",
    sidebarOpen: true,
    expose: false,
    browser: false,
    models: "",
    agent: false,
    tools: false,
    workingDir: "",
    contextLength: 0,
    maxOutputTokens: 0,
    contextMode: "friendly",
    reserveOutputTokens: 1024,
    nearFullThresholdPercent: 85,
    enableAutoTrim: true,
    enableAutoSummarize: true,
    enableRetrieval: true,
    retrievalScope: "current",
    retrievalChatIds: [],
    retrievalExcludedChatIds: [],
    retrievalLimit: 4,
    expertMode: false,
    expertInstructions: "",
    webSearchMode: "off",
    webSearchEnabled: false,
    webSearchProvider: "off",
    thinkEnabled: true,
    thinkLevel: "none",
    autoUpdateEnabled: true,
    compactMessages: false,
    imageGenerationWidth: 1024,
    imageGenerationHeight: 1024,
    imageGenerationSteps: 20
  };
}
