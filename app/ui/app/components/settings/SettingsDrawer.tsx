"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bolt,
  CheckCircle2,
  Cloud,
  Cpu,
  Database,
  Download,
  Folder,
  HardDrive,
  RefreshCcw,
  RotateCcw,
  Server,
  Settings,
  Shield,
  Trash2,
  Wifi,
  Wrench,
  X,
  type LucideIcon
} from "lucide-react";
import { ConnectionIndicator } from "@/components/status/ConnectionIndicator";
import { ModelManager } from "@/components/settings/ModelManager";
import { IconButton } from "@/components/ui/IconButton";
import {
  disconnectUser,
  fetchConnectUrl,
  fetchUser,
  getApiBase,
  getCloudStatus,
  getInferenceCompute,
  updateCloudSetting
} from "@/lib/ollama/client";
import {
  DEFAULT_CORE_API_BASE,
  SAME_ORIGIN_CORE_API_BASE,
  getCoreApiBase
} from "@/lib/ollama/standalone";
import { cn, formatBytes } from "@/lib/utils";
import type { useOllamaConnection } from "@/hooks/useOllamaConnection";
import type { AppMode } from "@/lib/appMode";
import type {
  CloudStatusResponse,
  OllamaModel,
  OllamaUser
} from "@/lib/ollama/types";
import type { LocalSettings } from "@/types/app";

const CONTEXT_LENGTH_OPTIONS = [4096, 8192, 16384, 32768, 65536, 131072, 262144];

type SettingsTabId = "general" | "models" | "chat" | "advanced" | "data";

const SETTINGS_TABS: Array<{
  id: SettingsTabId;
  label: string;
  Icon: LucideIcon;
}> = [
  { id: "general", label: "General", Icon: Settings },
  { id: "models", label: "Models", Icon: Cpu },
  { id: "chat", label: "Chat", Icon: Bolt },
  { id: "advanced", label: "Server", Icon: Server },
  { id: "data", label: "Data", Icon: Database }
];

interface SettingsDrawerProps {
  open: boolean;
  appMode: AppMode;
  settings: LocalSettings;
  settingsError: string | null;
  settingsLoading: boolean;
  connection: ReturnType<typeof useOllamaConnection>;
  chatCount: number;
  models: OllamaModel[];
  selectedModel: string;
  onClose(): void;
  onChangeMode(mode: AppMode): void;
  onSelectModel(model: string): void;
  onUpdateSettings(updates: Partial<LocalSettings>): Promise<void> | void;
  onRefreshConnection(): void;
  onRefreshModels(): void;
  onDeleteAllChats(): Promise<number> | number;
}

export function SettingsDrawer({
  open,
  appMode,
  settings,
  settingsError,
  settingsLoading,
  connection,
  chatCount,
  models,
  selectedModel,
  onClose,
  onChangeMode,
  onSelectModel,
  onUpdateSettings,
  onRefreshConnection,
  onRefreshModels,
  onDeleteAllChats
}: SettingsDrawerProps) {
  const [cloudStatus, setCloudStatus] = useState<CloudStatusResponse | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [user, setUser] = useState<OllamaUser | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [awaitingSignIn, setAwaitingSignIn] = useState(false);
  const [defaultContextLength, setDefaultContextLength] = useState<number | null>(null);
  const [toolsAvailable, setToolsAvailable] = useState(false);
  const [saved, setSaved] = useState(false);
  const [restartNotice, setRestartNotice] = useState(false);
  const [confirmDeleteChats, setConfirmDeleteChats] = useState(false);
  const [deletingChats, setDeletingChats] = useState(false);
  const [deleteChatsError, setDeleteChatsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");

  const standalone = appMode === "standalone";
  const cloudOverriddenByEnv = cloudStatus?.source === "env" || cloudStatus?.source === "both";
  const cloudEnabled = !(cloudStatus?.disabled ?? false);
  const cloudToggleDisabled = cloudLoading || cloudOverriddenByEnv || connection.status !== "connected";

  const effectiveContextLength = settings.contextLength || defaultContextLength || CONTEXT_LENGTH_OPTIONS[0];
  const effectiveApiBase = standalone
    ? getCoreApiBase(settings.coreApiBase)
    : getApiBase() || "same origin";
  const modelManagerApiBase = standalone
    ? settings.coreApiBase || undefined
    : getApiBase() || SAME_ORIGIN_CORE_API_BASE;

  const visibleModels = useMemo(() => models.slice(0, 7), [models]);
  const tabs = useMemo(
    () =>
      SETTINGS_TABS.map((tab) =>
        tab.id === "advanced" && standalone
          ? { ...tab, label: "Storage", Icon: Database }
          : tab
      ),
    [standalone]
  );

  useEffect(() => {
    setToolsAvailable(Boolean(window.OLLAMA_TOOLS));
  }, []);

  useEffect(() => {
    if (!open) {
      setConfirmDeleteChats(false);
      setDeleteChatsError(null);
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || standalone || connection.status !== "connected") return;

    const controller = new AbortController();

    setCloudLoading(true);
    setCloudError(null);
    getCloudStatus(controller.signal)
      .then(setCloudStatus)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setCloudError(error instanceof Error ? error.message : "Failed to load cloud setting");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCloudLoading(false);
      });

    setUserLoading(true);
    setUserError(null);
    fetchUser(controller.signal)
      .then(setUser)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setUserError(error instanceof Error ? error.message : "Failed to load account");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setUserLoading(false);
      });

    getInferenceCompute(controller.signal)
      .then((response) => setDefaultContextLength(response.defaultContextLength))
      .catch(() => {
        if (!controller.signal.aborted) setDefaultContextLength(null);
      });

    return () => controller.abort();
  }, [connection.status, open, standalone]);

  const showSaved = (restart = false) => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);

    if (restart) {
      setRestartNotice(true);
      window.setTimeout(() => setRestartNotice(false), 3000);
    }
  };

  const handleUpdate = async (updates: Partial<LocalSettings>, restart = false) => {
    await Promise.resolve(onUpdateSettings(updates));
    showSaved(restart);
  };

  const handleCloudToggle = async (enabled: boolean) => {
    if (cloudOverriddenByEnv) return;

    setCloudLoading(true);
    setCloudError(null);
    try {
      setCloudStatus(await updateCloudSetting(enabled));
      onRefreshModels();
      showSaved(true);
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : "Failed to update cloud setting");
    } finally {
      setCloudLoading(false);
    }
  };

  const handleSignIn = async () => {
    setUserError(null);
    setAwaitingSignIn(true);

    try {
      const connectUrl = await fetchConnectUrl();
      if (connectUrl) {
        window.open(connectUrl, "_blank", "noopener,noreferrer");
        setAwaitingSignIn(false);
        return;
      }

      setUser(await fetchUser());
      setAwaitingSignIn(false);
    } catch (error) {
      setUserError(error instanceof Error ? error.message : "Failed to start sign in");
      setAwaitingSignIn(false);
    }
  };

  const handleSignOut = async () => {
    setUserError(null);

    try {
      await disconnectUser();
      setUser(null);
      showSaved();
    } catch (error) {
      setUserError(error instanceof Error ? error.message : "Failed to sign out");
    }
  };

  const handleBrowseModels = async () => {
    const directory = await selectNativeDirectory("models");
    if (directory) {
      await handleUpdate({ models: directory }, true);
    }
  };

  const handleBrowseWorkingDirectory = async () => {
    const directory = await selectNativeDirectory("working");
    if (directory) {
      await handleUpdate({ workingDir: directory });
    }
  };

  const handleResetToDefaults = async () => {
    if (standalone) {
      await handleUpdate({
        selectedModel: "",
        coreApiBase: "",
        webSearchEnabled: false,
        thinkEnabled: true,
        thinkLevel: "none",
        compactMessages: false,
        contextMode: "friendly",
        contextLength: 0,
        maxOutputTokens: 0,
        reserveOutputTokens: 1024,
        nearFullThresholdPercent: 85,
        enableAutoTrim: true,
        enableAutoSummarize: false,
        imageGenerationWidth: 1024,
        imageGenerationHeight: 1024,
        imageGenerationSteps: 20
      });
      return;
    }

    await handleUpdate(
      {
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
        autoUpdateEnabled: true,
        imageGenerationWidth: 1024,
        imageGenerationHeight: 1024,
        imageGenerationSteps: 20
      },
      true
    );
  };

  const handleConfirmDeleteAllChats = async () => {
    setDeletingChats(true);
    setDeleteChatsError(null);

    try {
      await Promise.resolve(onDeleteAllChats());
      setConfirmDeleteChats(false);
      showSaved();
    } catch (error) {
      setDeleteChatsError(error instanceof Error ? error.message : "Failed to delete chats");
    } finally {
      setDeletingChats(false);
    }
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 flex items-center justify-center p-3 transition sm:p-6",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
      aria-hidden={!open}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/45 transition-opacity",
          open ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className={cn(
          "relative z-10 flex h-[min(760px,calc(100dvh-1.5rem))] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-panel transition duration-200 sm:h-[min(780px,calc(100dvh-3rem))]",
          open ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.98] opacity-0"
        )}
      >
        <div
          className="flex h-16 flex-none items-center gap-3 border-b border-border px-4"
          onMouseDown={() => window.drag?.()}
          onDoubleClick={() => window.doubleClick?.()}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-panel-strong text-accent">
            <Settings className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="settings-title" className="truncate text-base font-semibold">
              Settings
            </h2>
            <p className="truncate text-sm text-muted-foreground">
              {standalone
                ? "Standalone browser mode"
                : settingsLoading
                  ? "Syncing with Ollama"
                  : "Local app settings"}
            </p>
          </div>
          <IconButton label="Close settings" onClick={onClose}>
            <X className="h-5 w-5" />
          </IconButton>
        </div>

        <div
          role="tablist"
          aria-label="Settings sections"
          className="scrollbar-subtle flex flex-none gap-1 overflow-x-auto border-b border-border px-3 py-2"
        >
          {tabs.map(({ id, label, Icon }) => {
            const selected = activeTab === id;

            return (
              <button
                key={id}
                id={`settings-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`settings-panel-${id}`}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "inline-flex h-9 flex-none items-center gap-2 rounded-md px-3 text-sm transition focus:focus-ring",
                  selected
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>

        <div
          id={`settings-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab}`}
          className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto p-4"
        >
          {settingsError ? (
            <Notice tone="danger">{settingsError}</Notice>
          ) : null}
          {cloudError ? <Notice tone="danger">{cloudError}</Notice> : null}
          {userError ? <Notice tone="danger">{userError}</Notice> : null}
          {deleteChatsError ? <Notice tone="danger">{deleteChatsError}</Notice> : null}
          {restartNotice ? (
            <Notice tone="warning">Saved. Ollama is restarting to apply this change.</Notice>
          ) : null}
          {saved ? <Notice tone="success">Saved</Notice> : null}

          {activeTab === "general" ? (
            <>
              <SettingsSection
                title="Connection"
                action={
                  <IconButton label="Refresh connection" onClick={onRefreshConnection}>
                    <RefreshCcw className="h-4 w-4" />
                  </IconButton>
                }
              >
                <ConnectionIndicator connection={connection} />
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel-strong px-3 py-3">
                  <label htmlFor="app-mode" className="text-sm font-medium">
                    Mode
                  </label>
                  <select
                    id="app-mode"
                    value={appMode}
                    onChange={(event) => onChangeMode(event.target.value as AppMode)}
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm focus:focus-ring"
                  >
                    <option value="desktop">Desktop app</option>
                    <option value="standalone">Standalone</option>
                  </select>
                </div>
                <div className="rounded-md border border-border bg-panel-strong px-3 py-2 text-sm">
                  <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                    <Server className="h-4 w-4" />
                    API base
                  </div>
                  <code className="break-all text-xs text-foreground">
                    {effectiveApiBase}
                  </code>
                </div>
                {standalone ? (
                  <>
                    <div className="rounded-md border border-border bg-panel-strong px-3 py-3">
                      <label htmlFor="core-api-base" className="mb-2 block text-sm font-medium">
                        Core API base
                      </label>
                      <input
                        id="core-api-base"
                        value={settings.coreApiBase}
                        placeholder={DEFAULT_CORE_API_BASE}
                        onChange={(event) => onUpdateSettings({ coreApiBase: event.target.value })}
                        onBlur={onRefreshConnection}
                        className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:focus-ring"
                      />
                    </div>
                    <Notice tone="warning">
                      Standalone mode uses the core Ollama API and stores chats in this browser.
                    </Notice>
                  </>
                ) : null}
              </SettingsSection>

              {!standalone ? (
                <SettingsSection title="Ollama Account">
                  {userLoading ? (
                    <div className="rounded-md border border-border bg-panel-strong px-3 py-3 text-sm text-muted-foreground">
                      Checking account...
                    </div>
                  ) : user?.name || user?.email ? (
                    <div className="flex items-center gap-3 rounded-md border border-border bg-panel-strong px-3 py-3">
                      {user.avatarurl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={user.avatarurl}
                          alt=""
                          className="h-10 w-10 rounded-full border border-border bg-muted"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold">
                          {(user.name || user.email || "O").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {user.name || "Ollama account"}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => window.open("https://ollama.com/settings", "_blank", "noopener,noreferrer")}
                        className="h-9 rounded-md border border-border px-3 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground focus:focus-ring"
                      >
                        Manage
                      </button>
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="h-9 rounded-md border border-border px-3 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground focus:focus-ring"
                      >
                        Sign out
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel-strong px-3 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Not connected</div>
                        <div className="text-xs text-muted-foreground">
                          Sign in to manage Ollama cloud access.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleSignIn}
                        disabled={awaitingSignIn}
                        className="h-9 rounded-md border border-accent/45 bg-accent px-3 text-sm font-medium text-accent-foreground transition hover:bg-accent/90 focus:focus-ring disabled:opacity-55"
                      >
                        {awaitingSignIn ? "Opening..." : "Sign in"}
                      </button>
                    </div>
                  )}

                  <ToggleRow
                    icon={<Cloud className="h-4 w-4" />}
                    label="Cloud"
                    description={
                      cloudOverriddenByEnv
                        ? "OLLAMA_NO_CLOUD is forcing cloud off."
                        : "Enable cloud models and web search."
                    }
                    checked={cloudEnabled}
                    disabled={cloudToggleDisabled}
                    onChange={handleCloudToggle}
                  />
                </SettingsSection>
              ) : null}
            </>
          ) : null}

          {activeTab === "models" ? (
            <SettingsSection
              title="Model"
              action={
                <IconButton label="Refresh models" onClick={onRefreshModels}>
                  <RefreshCcw className="h-4 w-4" />
                </IconButton>
              }
            >
            <label className="sr-only" htmlFor="settings-model">
              Selected model
            </label>
            <select
              id="settings-model"
              value={selectedModel}
              onChange={(event) => onSelectModel(event.target.value)}
              className="h-11 w-full rounded-md border border-border bg-panel-strong px-3 text-sm focus:focus-ring"
            >
              {models.length === 0 ? (
                <option value="">No local models found</option>
              ) : null}
              {models.map((model) => (
                <option key={model.name} value={model.name}>
                  {model.displayName}
                </option>
              ))}
            </select>
            <div className="space-y-2">
              {visibleModels.map((model) => (
                <div
                  key={model.name}
                  className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{model.displayName}</div>
                    <div className="text-xs text-muted-foreground">
                      {model.local ? formatBytes(model.size) : "Pull on first chat"}
                    </div>
                  </div>
                  {model.name === selectedModel ? (
                    <CheckCircle2 className="h-4 w-4 flex-none text-accent" />
                  ) : null}
                </div>
              ))}
            </div>

            {standalone && models.length === 0 ? (
              <Notice tone="warning">
                No local models found from /api/tags. Pull a model with the Ollama CLI, then refresh.
              </Notice>
            ) : null}

            {!standalone ? (
              <PathRow
                icon={<Folder className="h-4 w-4" />}
                label="Model location"
                value={settings.models}
                placeholder="Default Ollama model directory"
                onBrowse={handleBrowseModels}
                onClear={() => handleUpdate({ models: "" }, true)}
              />
            ) : null}

              <ModelManager
                apiBase={modelManagerApiBase}
                models={models}
                selectedModel={selectedModel}
                onSelectModel={onSelectModel}
                onRefreshModels={onRefreshModels}
              />
            </SettingsSection>
          ) : null}

          {activeTab === "advanced" && !standalone ? (
          <SettingsSection title="Local Server">
            <ToggleRow
              icon={<Download className="h-4 w-4" />}
              label="Auto-download updates"
              description={
                settings.autoUpdateEnabled
                  ? "Updates download automatically when available."
                  : "Automatic update downloads are off."
              }
              checked={settings.autoUpdateEnabled}
              onChange={(autoUpdateEnabled) => handleUpdate({ autoUpdateEnabled })}
            />
            <ToggleRow
              icon={<Wifi className="h-4 w-4" />}
              label="Expose Ollama to the network"
              description="Allow other devices and services to reach the local server."
              checked={settings.expose}
              onChange={(expose) => handleUpdate({ expose }, true)}
            />
            <ToggleRow
              icon={<Shield className="h-4 w-4" />}
              label="Browser access"
              description="Allow local browser clients to use the desktop app server."
              checked={settings.browser}
              onChange={(browser) => handleUpdate({ browser })}
            />

            <div className="rounded-md border border-border bg-panel-strong px-3 py-3">
              <div className="mb-3 flex items-start gap-3">
                <Cpu className="mt-0.5 h-4 w-4 flex-none text-accent" />
                <div className="min-w-0 flex-1">
                  <label htmlFor="context-length" className="text-sm font-medium">
                    Context length
                  </label>
                  <div className="text-xs text-muted-foreground">
                    {formatContextLength(effectiveContextLength)}
                    {settings.contextLength ? "" : " default"}
                  </div>
                </div>
              </div>
              <input
                id="context-length"
                type="range"
                min={0}
                max={CONTEXT_LENGTH_OPTIONS.length - 1}
                step={1}
                value={Math.max(0, CONTEXT_LENGTH_OPTIONS.indexOf(effectiveContextLength))}
                disabled={!defaultContextLength}
                onChange={(event) =>
                  handleUpdate(
                    { contextLength: CONTEXT_LENGTH_OPTIONS[Number(event.target.value)] },
                    true
                  )
                }
                className="w-full accent-[var(--accent)] focus:focus-ring disabled:opacity-55"
              />
              <div className="mt-2 grid grid-cols-4 gap-1 text-[11px] text-muted-foreground sm:grid-cols-7">
                {CONTEXT_LENGTH_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleUpdate({ contextLength: value }, true)}
                    className={cn(
                      "rounded border border-transparent px-1 py-1 transition hover:border-border hover:bg-muted focus:focus-ring",
                      value === effectiveContextLength && "border-accent/40 text-accent"
                    )}
                  >
                    {formatContextLength(value)}
                  </button>
                ))}
              </div>
            </div>
          </SettingsSection>
          ) : null}

          {activeTab === "chat" ? (
          <SettingsSection title="Chat">
            {!standalone ? (
              <ToggleRow
                icon={<Cloud className="h-4 w-4" />}
                label="Web search"
                checked={settings.webSearchEnabled}
                onChange={(webSearchEnabled) => handleUpdate({ webSearchEnabled })}
              />
            ) : null}
            <ToggleRow
              icon={<Bolt className="h-4 w-4" />}
              label="Thinking"
              checked={settings.thinkEnabled}
              onChange={(thinkEnabled) => handleUpdate({ thinkEnabled })}
            />
            <ToggleRow
              icon={<HardDrive className="h-4 w-4" />}
              label="Compact messages"
              checked={settings.compactMessages}
              onChange={(compactMessages) => handleUpdate({ compactMessages })}
            />
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel-strong px-3 py-3">
              <label htmlFor="thinking-level" className="text-sm">
                Thinking level
              </label>
              <select
                id="thinking-level"
                value={settings.thinkLevel}
                disabled={!settings.thinkEnabled}
                onChange={(event) =>
                  handleUpdate({
                    thinkLevel: event.target.value as LocalSettings["thinkLevel"]
                  })
                }
                className="h-9 rounded-md border border-border bg-background px-2 text-sm focus:focus-ring disabled:opacity-50"
              >
                <option value="none">Auto</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="rounded-md border border-border bg-panel-strong px-3 py-3">
              <div className="mb-3">
                <div className="text-sm font-medium">Context mode</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Strict prevents Ollama from silently truncating or shifting context. Friendly keeps recent turns and warns when older messages are omitted.
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["friendly", "strict"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => handleUpdate({ contextMode: mode })}
                    className={cn(
                      "h-10 rounded-md border px-3 text-sm capitalize transition focus:focus-ring",
                      settings.contextMode === mode
                        ? "border-accent/45 bg-accent text-accent-foreground"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <NumericRow
              label="Context window"
              value={settings.contextLength}
              placeholder="Auto"
              min={0}
              step={1024}
              onChange={(contextLength) => handleUpdate({ contextLength })}
            />
            <NumericRow
              label="Max output tokens"
              value={settings.maxOutputTokens}
              placeholder="Auto"
              min={0}
              step={128}
              onChange={(maxOutputTokens) => handleUpdate({ maxOutputTokens })}
            />
            <NumericRow
              label="Reserve output budget"
              value={settings.reserveOutputTokens}
              min={0}
              step={128}
              onChange={(reserveOutputTokens) => handleUpdate({ reserveOutputTokens })}
            />
            <NumericRow
              label="Near-full warning"
              value={settings.nearFullThresholdPercent}
              suffix="%"
              min={1}
              max={100}
              step={1}
              onChange={(nearFullThresholdPercent) =>
                handleUpdate({ nearFullThresholdPercent })
              }
            />
            <ToggleRow
              icon={<HardDrive className="h-4 w-4" />}
              label="Auto-trim old messages"
              description="Friendly mode can omit oldest outbound messages when the estimate exceeds the selected context."
              checked={settings.enableAutoTrim}
              onChange={(enableAutoTrim) => handleUpdate({ enableAutoTrim })}
            />
            <ToggleRow
              icon={<HardDrive className="h-4 w-4" />}
              label="Auto-summarize old messages"
              description="Reserved for a future summarization pass. Trimming is used for now."
              checked={settings.enableAutoSummarize}
              disabled
              onChange={() => handleUpdate({ enableAutoSummarize: false })}
            />
          </SettingsSection>
          ) : null}

          {activeTab === "advanced" && toolsAvailable && !standalone ? (
            <SettingsSection title="Agent Tools">
              <ToggleRow
                icon={<Bolt className="h-4 w-4" />}
                label="Agent mode"
                description="Use multi-turn tools for supported models."
                checked={settings.agent}
                onChange={(agent) => handleUpdate({ agent })}
              />
              <ToggleRow
                icon={<Wrench className="h-4 w-4" />}
                label="Tools mode"
                description="Use single-turn tools for supported models."
                checked={settings.tools}
                onChange={(tools) => handleUpdate({ tools })}
              />
              <PathRow
                icon={<Folder className="h-4 w-4" />}
                label="Working directory"
                value={settings.workingDir}
                placeholder="Default working directory"
                onBrowse={handleBrowseWorkingDirectory}
                onClear={() => handleUpdate({ workingDir: "" })}
              />
            </SettingsSection>
          ) : null}

          {activeTab === "advanced" && standalone ? (
            <SettingsSection title="Storage">
              <div className="rounded-md border border-border bg-panel-strong px-3 py-3">
                <div className="flex items-start gap-3">
                  <Database className="mt-0.5 h-4 w-4 flex-none text-accent" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Browser storage</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Chats are saved locally in IndexedDB for this browser profile.
                    </div>
                  </div>
                </div>
              </div>
            </SettingsSection>
          ) : null}

          {activeTab === "data" ? (
            <>
              <SettingsSection title="Data">
                <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center text-danger">
                        <Trash2 className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-danger">Delete all chats</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Permanently remove {chatCount === 1 ? "1 chat" : `${chatCount} chats`} stored on this device.
                        </div>
                        {confirmDeleteChats ? (
                          <div className="mt-2 text-xs text-danger">
                            This cannot be undone.
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {confirmDeleteChats ? (
                      <div className="flex flex-none gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteChats(false)}
                          disabled={deletingChats}
                          className="h-9 rounded-md border border-border px-3 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground focus:focus-ring disabled:opacity-55"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleConfirmDeleteAllChats}
                          disabled={
                            deletingChats ||
                            chatCount === 0 ||
                            (!standalone && connection.status !== "connected")
                          }
                          className="h-9 rounded-md border border-danger/50 bg-danger px-3 text-sm font-medium text-background transition hover:bg-danger/90 focus:focus-ring disabled:opacity-55"
                        >
                          {deletingChats ? "Deleting..." : "Confirm"}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteChats(true)}
                        disabled={
                          deletingChats ||
                          chatCount === 0 ||
                          (!standalone && connection.status !== "connected")
                        }
                        className="h-9 flex-none rounded-md border border-danger/40 px-3 text-sm font-medium text-danger transition hover:bg-danger/10 focus:focus-ring disabled:opacity-55"
                      >
                        Delete all
                      </button>
                    )}
                  </div>
                </div>
              </SettingsSection>

              <div className="flex justify-end pb-2">
                <button
                  type="button"
                  onClick={handleResetToDefaults}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground focus:focus-ring"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset to defaults
                </button>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SettingsSection({
  title,
  action,
  children
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  checked,
  disabled,
  onChange
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label
      className={cn(
        "flex items-start justify-between gap-3 rounded-md border border-border bg-panel-strong px-3 py-3",
        disabled && "opacity-65"
      )}
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center text-accent">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{label}</span>
          {description ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
          ) : null}
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 flex-none accent-[var(--accent)] focus:focus-ring"
      />
    </label>
  );
}

function NumericRow({
  label,
  value,
  placeholder,
  suffix,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  placeholder?: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange(value: number): void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel-strong px-3 py-3">
      <label htmlFor={`settings-${label.toLowerCase().replace(/\s+/g, "-")}`} className="text-sm">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`settings-${label.toLowerCase().replace(/\s+/g, "-")}`}
          type="number"
          value={value || ""}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
          className="h-9 w-32 rounded-md border border-border bg-background px-2 text-sm focus:focus-ring"
        />
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );
}

function PathRow({
  icon,
  label,
  value,
  placeholder,
  onBrowse,
  onClear
}: {
  icon: ReactNode;
  label: string;
  value: string;
  placeholder: string;
  onBrowse(): void;
  onClear(): void;
}) {
  return (
    <div className="rounded-md border border-border bg-panel-strong px-3 py-3">
      <div className="mb-2 flex items-center gap-3">
        <span className="flex h-6 w-6 flex-none items-center justify-center text-accent">
          {icon}
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={value}
          readOnly
          placeholder={placeholder}
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground focus:focus-ring"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBrowse}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm transition hover:bg-muted focus:focus-ring sm:flex-none"
          >
            <Folder className="h-4 w-4" />
            Browse
          </button>
          {value ? (
            <button
              type="button"
              onClick={onClear}
              className="h-10 rounded-md border border-border px-3 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground focus:focus-ring"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Notice({
  tone,
  children
}: {
  tone: "danger" | "success" | "warning";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-4 rounded-md border px-3 py-2 text-sm",
        tone === "danger" && "border-danger/30 bg-danger/10 text-danger",
        tone === "success" && "border-success/30 bg-success/10 text-success",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning"
      )}
    >
      {children}
    </div>
  );
}

function formatContextLength(value: number) {
  if (!value) return "Default";
  return `${Math.round(value / 1024)}k`;
}

async function selectNativeDirectory(kind: "models" | "working") {
  const direct =
    kind === "models"
      ? window.webview?.selectModelsDirectory
      : window.webview?.selectWorkingDirectory;

  if (direct) return direct();

  const trigger =
    kind === "models" ? window.selectModelsDirectory : window.selectWorkingDirectory;
  if (!trigger) return null;

  const callbackName =
    kind === "models"
      ? "__selectModelsDirectoryCallback"
      : "__selectWorkingDirectoryCallback";

  return new Promise<string | null>((resolve) => {
    const previous = window[callbackName];
    const timeout = window.setTimeout(() => finish(null), 120000);

    const finish = (directory: string | null) => {
      window.clearTimeout(timeout);
      window[callbackName] = previous;
      resolve(directory);
    };

    window[callbackName] = finish;

    Promise.resolve(trigger()).catch(() => finish(null));
  });
}
