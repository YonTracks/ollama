"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getSettings,
  updateSettings as updateServerSettings
} from "@/lib/ollama/client";
import type { AppMode } from "@/lib/appMode";
import type { Settings } from "@/lib/ollama/types";
import type { LocalSettings } from "@/types/app";

const SETTINGS_KEY = "ollama.app.settings.v1";
const STANDALONE_SETTINGS_KEY = "ollama.app.standalone.settings.v1";
const CONTEXT_DEFAULTS_VERSION = 2;

const DEFAULT_SETTINGS: LocalSettings = {
  selectedModel: "",
  coreApiBase: "",
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
  contextDefaultsVersion: CONTEXT_DEFAULTS_VERSION,
  retrievalLimit: 4,
  expertMode: false,
  expertInstructions: "",
  webSearchEnabled: false,
  thinkEnabled: true,
  thinkLevel: "none",
  autoUpdateEnabled: true,
  compactMessages: false,
  imageGenerationWidth: 1024,
  imageGenerationHeight: 1024,
  imageGenerationSteps: 20
};

function defaultSidebarOpen() {
  if (typeof window === "undefined") return DEFAULT_SETTINGS.sidebarOpen;
  return window.matchMedia("(min-width: 768px)").matches;
}

function getDefaultSettings(): LocalSettings {
  return {
    ...DEFAULT_SETTINGS,
    sidebarOpen: defaultSidebarOpen()
  };
}

function settingsKey(mode: AppMode) {
  return mode === "standalone" ? STANDALONE_SETTINGS_KEY : SETTINGS_KEY;
}

function readLocalSettings(mode: AppMode) {
  try {
    const raw = localStorage.getItem(settingsKey(mode));
    const defaults = getDefaultSettings();
    if (!raw) return defaults;

    return normalizeLocalSettings(
      migrateLocalSettings({
        ...defaults,
        ...(JSON.parse(raw) as Partial<LocalSettings>)
      })
    );
  } catch {
    return getDefaultSettings();
  }
}

function migrateLocalSettings(settings: LocalSettings): LocalSettings {
  if ((settings.contextDefaultsVersion ?? 0) >= CONTEXT_DEFAULTS_VERSION) {
    return settings;
  }

  return {
    ...settings,
    enableAutoSummarize: true,
    enableRetrieval: true,
    contextDefaultsVersion: CONTEXT_DEFAULTS_VERSION
  };
}

function toLocalSettings(serverSettings?: Settings, current = getDefaultSettings()): LocalSettings {
  if (!serverSettings) return current;

  return normalizeLocalSettings({
    ...current,
    selectedModel: serverSettings.SelectedModel ?? current.selectedModel,
    sidebarOpen: serverSettings.SidebarOpen ?? current.sidebarOpen,
    expose: serverSettings.Expose ?? current.expose,
    browser: serverSettings.Browser ?? current.browser,
    models: serverSettings.Models ?? current.models,
    agent: serverSettings.Agent ?? current.agent,
    tools: serverSettings.Tools ?? current.tools,
    workingDir: serverSettings.WorkingDir ?? current.workingDir,
    contextLength: serverSettings.ContextLength ?? current.contextLength,
    webSearchEnabled: serverSettings.WebSearchEnabled ?? current.webSearchEnabled,
    thinkEnabled: serverSettings.ThinkEnabled ?? current.thinkEnabled,
    thinkLevel:
      serverSettings.ThinkLevel === "low" ||
      serverSettings.ThinkLevel === "medium" ||
      serverSettings.ThinkLevel === "high"
        ? serverSettings.ThinkLevel
        : current.thinkLevel,
    autoUpdateEnabled: serverSettings.AutoUpdateEnabled ?? current.autoUpdateEnabled
  });
}

function toServerSettings(settings: LocalSettings, serverSettings?: Settings): Settings {
  const normalized = normalizeLocalSettings(settings);
  return {
    ...serverSettings,
    Expose: normalized.expose,
    Browser: normalized.browser,
    Models: normalized.models,
    Agent: normalized.agent,
    Tools: normalized.tools,
    WorkingDir: normalized.workingDir,
    ContextLength: normalized.contextLength,
    AutoUpdateEnabled: normalized.autoUpdateEnabled,
    SelectedModel: normalized.selectedModel,
    SidebarOpen: normalized.sidebarOpen,
    WebSearchEnabled: normalized.webSearchEnabled,
    ThinkEnabled: normalized.thinkEnabled,
    ThinkLevel: normalized.thinkLevel
  };
}

function normalizeLocalSettings(settings: LocalSettings): LocalSettings {
  return normalizeToolMode({
    ...settings,
    retrievalScope:
      settings.retrievalScope === "selected" || settings.retrievalScope === "all"
        ? settings.retrievalScope
        : "current",
    retrievalChatIds: uniqueStrings(settings.retrievalChatIds),
    retrievalExcludedChatIds: uniqueStrings(settings.retrievalExcludedChatIds)
  });
}

function normalizeToolMode(settings: LocalSettings): LocalSettings {
  if (!settings.agent || !settings.tools) {
    return settings;
  }

  return {
    ...settings,
    tools: false
  };
}

function uniqueStrings(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function useLocalSettings(mode: AppMode, enabled = true) {
  const [settings, setSettingsState] = useState<LocalSettings>(DEFAULT_SETTINGS);
  const [serverSettings, setServerSettings] = useState<Settings | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    setServerSettings(undefined);
    setError(null);
    setSettingsState(readLocalSettings(mode));
    if (mode === "standalone") {
      setLoading(false);
    }
  }, [enabled, mode]);

  const persistLocal = useCallback(
    (next: LocalSettings) => {
      setSettingsState(next);
      try {
        localStorage.setItem(settingsKey(mode), JSON.stringify(next));
      } catch {
        // Local settings are a convenience cache only.
      }
    },
    [mode]
  );

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || mode === "standalone") {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await getSettings(signal);
      setServerSettings(response.settings);
      setSettingsState((current) => {
        const next = toLocalSettings(response.settings, current);
        try {
          localStorage.setItem(settingsKey(mode), JSON.stringify(next));
        } catch {
          // Ignore local persistence failures.
        }
        return next;
      });
    } catch (refreshError) {
      const message =
        refreshError instanceof Error ? refreshError.message : "Failed to load settings";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [enabled, mode]);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const updateSettings = useCallback(
    async (updates: Partial<LocalSettings>) => {
      const next = normalizeToolMode({ ...settings, ...updates });
      setError(null);
      persistLocal(next);

      if (mode === "standalone") {
        return true;
      }

      if (!serverSettings) {
        return true;
      }

      try {
        const response = await updateServerSettings(toServerSettings(next, serverSettings));
        setServerSettings(response.settings);
        persistLocal(toLocalSettings(response.settings, next));
        return true;
      } catch (updateError) {
        const message =
          updateError instanceof Error ? updateError.message : "Failed to update settings";
        setError(message);
        return false;
      }
    },
    [mode, persistLocal, serverSettings, settings]
  );

  return useMemo(
    () => ({
      settings,
      serverSettings,
      loading,
      error,
      refresh,
      updateSettings
    }),
    [error, loading, refresh, serverSettings, settings, updateSettings]
  );
}
