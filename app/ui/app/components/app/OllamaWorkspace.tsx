"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { AdminSecurityDashboard } from "@/components/admin/AdminSecurityDashboard";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SettingsDrawer } from "@/components/settings/SettingsDrawer";
import { TopBar } from "@/components/topbar/TopBar";
import { useToast } from "@/components/ui/ToastProvider";
import { useAppMode } from "@/hooks/useAppMode";
import { useChatList, useChatSession } from "@/hooks/useChats";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { useModels } from "@/hooks/useModels";
import { useModelOperations, type ModelOperationSnapshot } from "@/hooks/useModelOperations";
import { useOllamaConnection } from "@/hooks/useOllamaConnection";
import { deleteAllChats, getApiBase } from "@/lib/ollama/client";
import { SAME_ORIGIN_CORE_API_BASE } from "@/lib/ollama/standalone";
import { deleteAllStandaloneChats } from "@/lib/ollama/standalone-db";
import { cn } from "@/lib/utils";
import type { LocalSettings } from "@/types/app";

interface OllamaWorkspaceProps {
  initialSettingsOpen?: boolean;
}

interface ToastOptions {
  silent?: boolean;
}

export function OllamaWorkspace({ initialSettingsOpen = false }: OllamaWorkspaceProps) {
  const appMode = useAppMode();
  const { showToast } = useToast();
  const settingsState = useLocalSettings(appMode.mode, appMode.ready);
  const { settings, updateSettings } = settingsState;
  const appDataEncryptionError = appDataEncryptionMessage(settingsState.error);
  const connection = useOllamaConnection(
    appMode.mode,
    settings.coreApiBase,
    settings.coreApiToken,
    appMode.ready
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);
  const [adminOpen, setAdminOpen] = useState(false);
  const [allowMobileSidebarOpen, setAllowMobileSidebarOpen] = useState(false);

  const connected = appMode.ready && connection.status === "connected";
  const localDataEnabled = appMode.ready && (appMode.standalone || connected);
  const modelState = useModels(
    connected,
    appMode.mode,
    settings.coreApiBase,
    settings.coreApiToken
  );
  const chatList = useChatList(localDataEnabled, appMode.mode);

  const selectedModel = useMemo(() => {
    return (
      settings.selectedModel ||
      modelState.localModels[0]?.name ||
      modelState.models[0]?.name ||
      ""
    );
  }, [
    modelState.localModels,
    modelState.models,
    settings.selectedModel
  ]);

  useEffect(() => {
    if (!settings.selectedModel && selectedModel) {
      updateSettings({ selectedModel });
    }
  }, [selectedModel, settings.selectedModel, updateSettings]);

  useEffect(() => {
    const syncSettingsRoute = () => {
      const path = window.location.pathname;
      setAdminOpen(path.startsWith("/admin"));
      setSettingsOpen(path.startsWith("/settings"));
    };

    syncSettingsRoute();
    window.addEventListener("popstate", syncSettingsRoute);
    return () => window.removeEventListener("popstate", syncSettingsRoute);
  }, []);

  useEffect(() => {
    if (
      !appMode.ready ||
      allowMobileSidebarOpen ||
      !settings.sidebarOpen
    ) {
      return;
    }

    if (window.matchMedia("(max-width: 767px)").matches) {
      updateSettings({ sidebarOpen: false });
    }
  }, [allowMobileSidebarOpen, appMode.ready, settings.sidebarOpen, updateSettings]);

  const chatSession = useChatSession({
    chatId: activeChatId,
    mode: appMode.mode,
    coreApiBase: settings.coreApiBase,
    coreApiToken: settings.coreApiToken,
    selectedModel,
    settings,
    enabled: localDataEnabled,
    onChatCreated: setActiveChatId,
    onRefreshNeeded: () => {
      chatList.refresh();
      modelState.refresh();
    }
  });
  const refreshChatList = chatList.refresh;
  const reloadActiveChat = chatSession.reload;

  const handleRefreshModels = useCallback(
    async (options?: ToastOptions) => {
      const refreshed = await modelState.refresh();
      if (!options?.silent) {
        showToast({
          id: "models-refresh",
          title: refreshed ? "Models refreshed" : "Could not refresh models",
          description: refreshed
            ? "The model list is up to date."
            : "Check the Ollama connection and try again.",
          tone: refreshed ? "success" : "danger",
          duration: refreshed ? 2600 : 7000
        });
      }
      return refreshed;
    },
    [modelState, showToast]
  );

  const handleRefreshConnection = useCallback(
    async (options?: ToastOptions) => {
      const connected = await connection.refresh();
      if (!options?.silent) {
        showToast({
          id: "connection-refresh",
          title: connected ? "Connection refreshed" : "Ollama is not reachable",
          description: connected
            ? "The app can reach the local Ollama API."
            : "Check that Ollama is running, then refresh again.",
          tone: connected ? "success" : "danger",
          duration: connected ? 2600 : 7000
        });
      }
      return connected;
    },
    [connection, showToast]
  );

  const handleRefreshChats = useCallback(
    async (options?: ToastOptions) => {
      await refreshChatList();
      await reloadActiveChat();
      if (!options?.silent) {
        showToast({
          id: "chats-refresh",
          title: "Chats refreshed",
          description: "The conversation list is up to date.",
          tone: "success",
          duration: 2600
        });
      }
      return true;
    },
    [refreshChatList, reloadActiveChat, showToast]
  );

  const handleSelectModel = useCallback(
    async (selected: string, options?: ToastOptions) => {
      const previous = settings.selectedModel;
      const saved = await updateSettings({ selectedModel: selected });

      if (saved === false) {
        showToast({
          id: "model-select",
          title: "Model selection was not saved",
          description: "Check the Ollama connection and try again.",
          tone: "danger",
          duration: 7000
        });
        return false;
      }

      if (!options?.silent && selected && selected !== previous) {
        showToast({
          id: "model-select",
          title: "Model selected",
          description: selected,
          tone: "success"
        });
      }

      return true;
    },
    [settings.selectedModel, showToast, updateSettings]
  );

  const modelOperations = useModelOperations({
    apiBase:
      appMode.mode === "standalone"
        ? settings.coreApiBase || undefined
        : getApiBase() || SAME_ORIGIN_CORE_API_BASE,
    apiToken: appMode.mode === "standalone" ? settings.coreApiToken : undefined,
    selectedModel,
    onSelectModel: handleSelectModel,
    onRefreshModels: handleRefreshModels
  });

  const handleQuickSettingsUpdate = useCallback(
    async (updates: Partial<LocalSettings>) => {
      const saved = await updateSettings(updates);
      if (saved === false) {
        showToast({
          id: "quick-setting",
          title: "Setting was not saved",
          description: "Check the Ollama connection and try again.",
          tone: "danger",
          duration: 7000
        });
        return false;
      }

      showToast({
        id: "quick-setting",
        title: "Chat setting saved",
        description: quickSettingsToastDescription(updates),
        tone: "success",
        duration: 2200
      });
      return true;
    },
    [showToast, updateSettings]
  );

  const handleNewChat = useCallback(() => {
    chatSession.detachNewChatStream();
    setActiveChatId(null);
  }, [chatSession]);

  const handleDeleteChat = async (chatId: string) => {
    if (chatSession.streamingChatIds.includes(chatId)) {
      showToast({
        id: "chat-delete-streaming",
        title: "Chat is still generating",
        description: "Stop the background request before deleting this conversation.",
        tone: "warning",
        duration: 4200
      });
      return;
    }

    try {
      await chatList.remove(chatId);
      if (activeChatId === chatId) {
        setActiveChatId(null);
      }
      if (settings.retrievalChatIds.includes(chatId)) {
        await updateSettings({
          retrievalChatIds: settings.retrievalChatIds.filter((id) => id !== chatId),
          retrievalExcludedChatIds: settings.retrievalExcludedChatIds.filter((id) => id !== chatId)
        });
      } else if (settings.retrievalExcludedChatIds.includes(chatId)) {
        await updateSettings({
          retrievalExcludedChatIds: settings.retrievalExcludedChatIds.filter((id) => id !== chatId)
        });
      }
      showToast({
        id: "chat-deleted",
        title: "Chat deleted",
        description: "The conversation was removed.",
        tone: "success"
      });
    } catch (error) {
      showToast({
        id: "chat-deleted",
        title: "Could not delete chat",
        description: error instanceof Error ? error.message : "The conversation was not removed.",
        tone: "danger",
        duration: 7000
      });
    }
  };

  const handleRenameChat = async (chatId: string, title: string) => {
    const previousTitle = chatList.chats.find((chat) => chat.id === chatId)?.title ?? "";
    if (title.trim() === previousTitle.trim()) return;

    try {
      await chatList.rename(chatId, title);
      showToast({
        id: "chat-renamed",
        title: "Chat renamed",
        description: title,
        tone: "success"
      });
    } catch (error) {
      showToast({
        id: "chat-renamed",
        title: "Could not rename chat",
        description: error instanceof Error ? error.message : "The title was not saved.",
        tone: "danger",
        duration: 7000
      });
    }
  };

  const handleDeleteAllChats = async () => {
    const deletedCount =
      appMode.mode === "standalone" ? await deleteAllStandaloneChats() : await deleteAllChats();
    setActiveChatId(null);
    if (settings.retrievalChatIds.length > 0 || settings.retrievalExcludedChatIds.length > 0) {
      await updateSettings({ retrievalChatIds: [], retrievalExcludedChatIds: [] });
    }
    await chatList.refresh();
    return deletedCount;
  };

  const handleToggleSidebar = (sidebarOpen: boolean) => {
    setAllowMobileSidebarOpen(true);
    updateSettings({ sidebarOpen });
  };

  const openSettings = () => {
    setAdminOpen(false);
    setSettingsOpen(true);
    if (!window.location.pathname.startsWith("/settings")) {
      window.history.pushState({}, "", "/settings");
    }
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    if (window.location.pathname.startsWith("/settings")) {
      window.history.pushState({}, "", "/");
    }
  };

  const openAdmin = () => {
    setSettingsOpen(false);
    setAdminOpen(true);
    if (!window.location.pathname.startsWith("/admin")) {
      window.history.pushState({}, "", "/admin");
    }
  };

  const closeAdmin = () => {
    setAdminOpen(false);
    if (window.location.pathname.startsWith("/admin")) {
      window.history.pushState({}, "", "/");
    }
  };

  if (adminOpen) {
    return <AdminSecurityDashboard onClose={closeAdmin} />;
  }

  return (
    <div className="app-viewport-safe h-dvh overflow-hidden bg-background text-foreground">
      <div className="relative flex h-full min-h-0">
        <Sidebar
          chats={chatList.chats}
          activeChatId={activeChatId}
          loading={chatList.loading}
          error={chatList.error}
          open={settings.sidebarOpen}
          streamingChatIds={chatSession.streamingChatIds}
          allowMobileOpen={allowMobileSidebarOpen}
          onToggle={handleToggleSidebar}
          onNewChat={handleNewChat}
          onSelectChat={setActiveChatId}
          onRenameChat={handleRenameChat}
          onDeleteChat={handleDeleteChat}
          onOpenSettings={openSettings}
        />

        <main
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            "border-l border-border/70 bg-background/88 backdrop-blur"
          )}
        >
          <TopBar
            connection={connection}
            models={modelState.models}
            modelsLoading={modelState.loading}
            modelError={modelState.error}
            selectedModel={selectedModel}
            onSelectModel={handleSelectModel}
            onToggleSidebar={() =>
              handleToggleSidebar(!settings.sidebarOpen)
            }
            onOpenAdmin={openAdmin}
            onOpenSettings={openSettings}
            onRefreshConnection={handleRefreshConnection}
            onRefreshModels={() => {
              void handleRefreshModels();
            }}
          />

          {!settingsOpen && modelOperations.snapshot.operation ? (
            <ModelOperationBanner
              snapshot={modelOperations.snapshot}
              onOpenSettings={openSettings}
            />
          ) : null}

          {appDataEncryptionError ? (
            <div className="border-b border-danger/30 bg-danger/10 px-4 py-3 text-danger">
              <div className="mx-auto flex max-w-4xl items-start gap-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                <div className="min-w-0">
                  <div className="font-medium">App data is locked</div>
                  <div className="mt-0.5 text-xs leading-5 text-danger/90">
                    {appDataEncryptionError}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <ChatPanel
            activeChatId={activeChatId}
            connection={connection}
            selectedModel={selectedModel}
            settings={settings}
            chat={chatSession}
            onUpdateSettings={handleQuickSettingsUpdate}
          />
        </main>
      </div>

      <SettingsDrawer
        open={settingsOpen}
        appMode={appMode.mode}
        settings={settings}
        settingsError={settingsState.error}
        settingsLoading={settingsState.loading}
        connection={connection}
        chats={chatList.chats}
        chatCount={chatList.chats.length}
        models={modelState.models}
        selectedModel={selectedModel}
        modelOperations={modelOperations}
        onClose={closeSettings}
        onSelectModel={handleSelectModel}
        onUpdateSettings={updateSettings}
        onRefreshConnection={handleRefreshConnection}
        onRefreshModels={handleRefreshModels}
        onRefreshChats={handleRefreshChats}
        onDeleteAllChats={handleDeleteAllChats}
      />
    </div>
  );
}

function ModelOperationBanner({
  snapshot,
  onOpenSettings
}: {
  snapshot: ModelOperationSnapshot;
  onOpenSettings(): void;
}) {
  const percent = snapshot.progress
    ? Math.round((snapshot.progress.completed / Math.max(snapshot.progress.total, 1)) * 100)
    : null;

  return (
    <div className="border-b border-border bg-panel-strong px-4 py-2">
      <div className="mx-auto flex max-w-4xl items-center gap-3 text-sm">
        <RefreshCcw className="h-4 w-4 flex-none animate-spin text-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="min-w-0 truncate font-medium">
              {modelOperationLabel(snapshot.operation)} {snapshot.model ?? ""}
            </span>
            {percent !== null ? (
              <span className="flex-none text-xs text-muted-foreground">{percent}%</span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {snapshot.status ?? "Working"}
          </div>
          {percent !== null ? (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex h-8 flex-none items-center rounded-md border border-border px-3 text-xs font-medium transition hover:bg-muted focus:focus-ring"
        >
          Details
        </button>
      </div>
    </div>
  );
}

function modelOperationLabel(kind: ModelOperationSnapshot["operation"]) {
  if (kind === "pull") return "Pulling";
  if (kind === "create") return "Creating";
  if (kind === "import") return "Importing";
  if (kind === "delete") return "Deleting";
  return "Working on";
}

function quickSettingsToastDescription(updates: Partial<LocalSettings>) {
  if ("webSearchMode" in updates) {
    if (updates.webSearchMode === "auto") return "Web search auto mode enabled.";
    if (updates.webSearchMode === "manual") return "Web search manual mode enabled.";
    return "Web search disabled.";
  }
  if ("webSearchEnabled" in updates) {
    return updates.webSearchEnabled
      ? "Manual web search enabled."
      : "Manual web search disabled.";
  }
  if ("webSearchProvider" in updates) return "Web search provider updated.";
  if ("thinkEnabled" in updates) {
    return updates.thinkEnabled ? "Thinking enabled." : "Thinking disabled.";
  }
  if ("thinkLevel" in updates) return "Thinking level updated.";
  if (
    "imageGenerationWidth" in updates ||
    "imageGenerationHeight" in updates ||
    "imageGenerationSteps" in updates
  ) {
    return "Image generation settings updated.";
  }

  return "Your chat preferences are up to date.";
}

function appDataEncryptionMessage(message: string | null) {
  if (!message) return null;

  const normalized = message.toLowerCase();
  if (
    !normalized.includes("app data") &&
    !normalized.includes("ollama_app_data_key") &&
    !normalized.includes("message authentication failed")
  ) {
    return null;
  }

  if (normalized.includes("not unlock") || normalized.includes("message authentication failed")) {
    return "OLLAMA_APP_DATA_KEY did not unlock the encrypted desktop data. Set the correct key, or start once with OLLAMA_APP_DATA_ENCRYPTION=off and the correct key to decrypt it.";
  }

  return "Set OLLAMA_APP_DATA_KEY to the correct key, then restart Ollama.";
}
