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
  enableAutoSummarize: false,
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

    return {
      ...defaults,
      ...(JSON.parse(raw) as Partial<LocalSettings>)
    };
  } catch {
    return getDefaultSettings();
  }
}

function toLocalSettings(serverSettings?: Settings, current = getDefaultSettings()): LocalSettings {
  if (!serverSettings) return current;

  return {
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
  };
}

function toServerSettings(settings: LocalSettings, serverSettings?: Settings): Settings {
  return {
    ...serverSettings,
    Expose: settings.expose,
    Browser: settings.browser,
    Models: settings.models,
    Agent: settings.agent,
    Tools: settings.tools,
    WorkingDir: settings.workingDir,
    ContextLength: settings.contextLength,
    AutoUpdateEnabled: settings.autoUpdateEnabled,
    SelectedModel: settings.selectedModel,
    SidebarOpen: settings.sidebarOpen,
    WebSearchEnabled: settings.webSearchEnabled,
    ThinkEnabled: settings.thinkEnabled,
    ThinkLevel: settings.thinkLevel
  };
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
      const next = { ...settings, ...updates };
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
