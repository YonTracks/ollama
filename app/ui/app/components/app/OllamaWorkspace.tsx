"use client";

import { useEffect, useMemo, useState } from "react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SettingsDrawer } from "@/components/settings/SettingsDrawer";
import { TopBar } from "@/components/topbar/TopBar";
import { useAppMode } from "@/hooks/useAppMode";
import { useChatList, useChatSession } from "@/hooks/useChats";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { useModels } from "@/hooks/useModels";
import { useOllamaConnection } from "@/hooks/useOllamaConnection";
import { deleteAllChats } from "@/lib/ollama/client";
import { deleteAllStandaloneChats } from "@/lib/ollama/standalone-db";
import { cn } from "@/lib/utils";

interface OllamaWorkspaceProps {
  initialSettingsOpen?: boolean;
}

export function OllamaWorkspace({ initialSettingsOpen = false }: OllamaWorkspaceProps) {
  const appMode = useAppMode();
  const settingsState = useLocalSettings(appMode.mode, appMode.ready);
  const connection = useOllamaConnection(
    appMode.mode,
    settingsState.settings.coreApiBase,
    appMode.ready
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);

  const connected = appMode.ready && connection.status === "connected";
  const localDataEnabled = appMode.ready && (appMode.standalone || connected);
  const modelState = useModels(connected, appMode.mode, settingsState.settings.coreApiBase);
  const chatList = useChatList(localDataEnabled, appMode.mode);

  const selectedModel = useMemo(() => {
    return (
      settingsState.settings.selectedModel ||
      modelState.localModels[0]?.name ||
      modelState.models[0]?.name ||
      ""
    );
  }, [
    modelState.localModels,
    modelState.models,
    settingsState.settings.selectedModel
  ]);

  useEffect(() => {
    if (!settingsState.settings.selectedModel && selectedModel) {
      settingsState.updateSettings({ selectedModel });
    }
  }, [selectedModel, settingsState]);

  useEffect(() => {
    const syncSettingsRoute = () => {
      setSettingsOpen(window.location.pathname.startsWith("/settings"));
    };

    syncSettingsRoute();
    window.addEventListener("popstate", syncSettingsRoute);
    return () => window.removeEventListener("popstate", syncSettingsRoute);
  }, []);

  const chatSession = useChatSession({
    chatId: activeChatId,
    mode: appMode.mode,
    coreApiBase: settingsState.settings.coreApiBase,
    selectedModel,
    settings: settingsState.settings,
    enabled: localDataEnabled,
    onChatCreated: setActiveChatId,
    onRefreshNeeded: () => {
      chatList.refresh();
      modelState.refresh();
    }
  });

  const handleDeleteChat = async (chatId: string) => {
    await chatList.remove(chatId);
    if (activeChatId === chatId) {
      setActiveChatId(null);
    }
  };

  const handleDeleteAllChats = async () => {
    const deletedCount =
      appMode.mode === "standalone" ? await deleteAllStandaloneChats() : await deleteAllChats();
    setActiveChatId(null);
    await chatList.refresh();
    return deletedCount;
  };

  const handleChangeMode = (mode: typeof appMode.mode) => {
    setActiveChatId(null);
    appMode.setMode(mode);
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
    <div className="h-dvh overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-h-0">
        <Sidebar
          chats={chatList.chats}
          activeChatId={activeChatId}
          loading={chatList.loading}
          error={chatList.error}
          open={settingsState.settings.sidebarOpen}
          onToggle={(sidebarOpen) => settingsState.updateSettings({ sidebarOpen })}
          onNewChat={() => setActiveChatId(null)}
          onSelectChat={setActiveChatId}
          onRenameChat={chatList.rename}
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
            settings={settingsState.settings}
            onSelectModel={(selected) =>
              settingsState.updateSettings({ selectedModel: selected })
            }
            onToggleSidebar={() =>
              settingsState.updateSettings({
                sidebarOpen: !settingsState.settings.sidebarOpen
              })
            }
            onOpenSettings={openSettings}
            onRefreshModels={modelState.refresh}
          />

          <ChatPanel
            activeChatId={activeChatId}
            connection={connection}
            standalone={appMode.standalone}
            selectedModel={selectedModel}
            settings={settingsState.settings}
            chat={chatSession}
            onUpdateSettings={settingsState.updateSettings}
          />
        </main>
      </div>

      <SettingsDrawer
        open={settingsOpen}
        appMode={appMode.mode}
        settings={settingsState.settings}
        settingsError={settingsState.error}
        settingsLoading={settingsState.loading}
        connection={connection}
        chatCount={chatList.chats.length}
        models={modelState.models}
        selectedModel={selectedModel}
        onClose={closeSettings}
        onChangeMode={handleChangeMode}
        onSelectModel={(selectedModel) => settingsState.updateSettings({ selectedModel })}
        onUpdateSettings={settingsState.updateSettings}
        onRefreshConnection={() => connection.refresh()}
        onRefreshModels={modelState.refresh}
        onDeleteAllChats={handleDeleteAllChats}
      />
    </div>
  );
}
