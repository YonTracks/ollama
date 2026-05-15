"use client";

import {
  Menu,
  RefreshCcw,
  Settings,
  SlidersHorizontal,
  WifiOff
} from "lucide-react";
import { InstallButton } from "@/components/pwa/InstallButton";
import { ConnectionIndicator } from "@/components/status/ConnectionIndicator";
import { IconButton } from "@/components/ui/IconButton";
import { ModelSelector } from "@/components/topbar/ModelSelector";
import type { useOllamaConnection } from "@/hooks/useOllamaConnection";
import type { OllamaModel } from "@/lib/ollama/types";
import type { LocalSettings } from "@/types/app";

interface TopBarProps {
  connection: ReturnType<typeof useOllamaConnection>;
  models: OllamaModel[];
  modelsLoading: boolean;
  modelError: string | null;
  selectedModel: string;
  settings: LocalSettings;
  onSelectModel(model: string): void;
  onToggleSidebar(): void;
  onOpenSettings(): void;
  onRefreshModels(): void;
}

export function TopBar({
  connection,
  models,
  modelsLoading,
  modelError,
  selectedModel,
  settings,
  onSelectModel,
  onToggleSidebar,
  onOpenSettings,
  onRefreshModels
}: TopBarProps) {
  return (
    <header className="flex h-16 flex-none items-center gap-2 border-b border-border/70 px-3 sm:px-4">
      <IconButton label="Toggle sidebar" onClick={onToggleSidebar}>
        <Menu className="h-5 w-5" />
      </IconButton>

      <div className="min-w-0 flex-1">
        <ModelSelector
          models={models}
          loading={modelsLoading}
          error={modelError}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
          onRefreshModels={onRefreshModels}
        />
      </div>

      <div className="hidden items-center gap-2 md:flex">
        <ConnectionIndicator connection={connection} />
      </div>

      {!connection.online ? (
        <div className="flex h-9 items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 text-sm text-warning md:hidden">
          <WifiOff className="h-4 w-4" />
          Offline
        </div>
      ) : null}

      <InstallButton />

      <IconButton
        label={settings.compactMessages ? "Comfortable messages" : "Compact messages"}
        onClick={() => onOpenSettings()}
      >
        <SlidersHorizontal className="h-5 w-5" />
      </IconButton>

      <IconButton label="Refresh connection" onClick={() => connection.refresh()}>
        <RefreshCcw className="h-5 w-5" />
      </IconButton>

      <IconButton label="Open settings" onClick={onOpenSettings}>
        <Settings className="h-5 w-5" />
      </IconButton>
    </header>
  );
}
