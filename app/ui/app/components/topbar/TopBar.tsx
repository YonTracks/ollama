"use client";

import {
  Menu,
  RefreshCcw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  WifiOff
} from "lucide-react";
import { InstallButton } from "@/components/pwa/InstallButton";
import { ConnectionIndicator } from "@/components/status/ConnectionIndicator";
import { IconButton } from "@/components/ui/IconButton";
import { ModelSelector } from "@/components/topbar/ModelSelector";
import type { useOllamaConnection } from "@/hooks/useOllamaConnection";
import type { OllamaModel } from "@/lib/ollama/types";

interface TopBarProps {
  connection: ReturnType<typeof useOllamaConnection>;
  models: OllamaModel[];
  modelsLoading: boolean;
  modelError: string | null;
  selectedModel: string;
  onSelectModel(model: string): void;
  onToggleSidebar(): void;
  onOpenAdmin(): void;
  onOpenSettings(): void;
  onRefreshConnection(): void;
  onRefreshModels(): void;
}

export function TopBar({
  connection,
  models,
  modelsLoading,
  modelError,
  selectedModel,
  onSelectModel,
  onToggleSidebar,
  onOpenAdmin,
  onOpenSettings,
  onRefreshConnection,
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
          {connection.status === "connected" ? "Local only" : "Offline"}
        </div>
      ) : null}

      <div className="hidden sm:block">
        <InstallButton />
      </div>

      <IconButton
        label="Open chat display settings"
        onClick={() => onOpenSettings()}
      >
        <SlidersHorizontal className="h-5 w-5" />
      </IconButton>

      <IconButton
        label="Open admin security dashboard"
        className="hidden sm:inline-flex"
        onClick={onOpenAdmin}
      >
        <ShieldCheck className="h-5 w-5" />
      </IconButton>

      <IconButton
        label="Refresh connection"
        className="hidden sm:inline-flex"
        onClick={onRefreshConnection}
      >
        <RefreshCcw className="h-5 w-5" />
      </IconButton>

      <IconButton label="Open settings" onClick={onOpenSettings}>
        <Settings className="h-5 w-5" />
      </IconButton>
    </header>
  );
}
