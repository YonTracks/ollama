"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SettingsDrawer } from "@/components/settings/SettingsDrawer";
import { TopBar } from "@/components/topbar/TopBar";
import { useToast } from "@/components/ui/ToastProvider";
import { useAppMode } from "@/hooks/useAppMode";
import { useChatList, useChatSession } from "@/hooks/useChats";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { useModels } from "@/hooks/useModels";
import { useOllamaConnection } from "@/hooks/useOllamaConnection";
import { deleteAllChats } from "@/lib/ollama/client";
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
  const connection = useOllamaConnection(
    appMode.mode,
    settings.coreApiBase,
    settings.coreApiToken,
    appMode.ready
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);
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
      setSettingsOpen(window.location.pathname.startsWith("/settings"));
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

  const handleDeleteChat = async (chatId: string) => {
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

  return (
    <div className="app-viewport-safe h-dvh overflow-hidden bg-background text-foreground">
      <div className="relative flex h-full min-h-0">
        <Sidebar
          chats={chatList.chats}
          activeChatId={activeChatId}
          loading={chatList.loading}
          error={chatList.error}
          open={settings.sidebarOpen}
          allowMobileOpen={allowMobileSidebarOpen}
          onToggle={handleToggleSidebar}
          onNewChat={() => setActiveChatId(null)}
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
            onOpenSettings={openSettings}
            onRefreshConnection={handleRefreshConnection}
            onRefreshModels={() => {
              void handleRefreshModels();
            }}
          />

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
        onClose={closeSettings}
        onSelectModel={handleSelectModel}
        onUpdateSettings={updateSettings}
        onRefreshConnection={handleRefreshConnection}
        onRefreshModels={handleRefreshModels}
        onDeleteAllChats={handleDeleteAllChats}
      />
    </div>
  );
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
