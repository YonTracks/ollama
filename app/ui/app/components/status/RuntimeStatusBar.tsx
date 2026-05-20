"use client";

import type { useOllamaConnection } from "@/hooks/useOllamaConnection";
import type { AppMode } from "@/lib/appMode";
import { cn } from "@/lib/utils";
import type { LocalSettings } from "@/types/app";

interface RuntimeStatusBarProps {
  appMode: AppMode;
  connection: ReturnType<typeof useOllamaConnection>;
  settings: LocalSettings;
}

type StatusTone = "neutral" | "success" | "warning" | "danger";

interface RuntimeStatusItem {
  id: "mode" | "api" | "network" | "search" | "memory";
  label: string;
  tone: StatusTone;
  title?: string;
}

export function RuntimeStatusBar({
  appMode,
  connection,
  settings
}: RuntimeStatusBarProps) {
  const items = runtimeStatusItems(appMode, connection, settings);

  return (
    <div
      className="scrollbar-subtle flex h-8 flex-none items-center gap-3 overflow-x-auto border-b border-border/60 bg-background/80 px-3 text-[11px] font-medium leading-none text-muted-foreground sm:px-4"
      aria-label="Runtime status"
    >
      {items.map((item) => (
        <RuntimeStatusText
          key={item.id}
          label={item.label}
          tone={item.tone}
          title={item.title ?? item.label}
        />
      ))}
    </div>
  );
}

function runtimeStatusItems(
  appMode: AppMode,
  connection: ReturnType<typeof useOllamaConnection>,
  settings: LocalSettings
): RuntimeStatusItem[] {
  const apiName = appMode === "standalone" ? "Core API" : "Desktop API";
  const apiStatus = connection.status === "connected"
    ? "reachable"
    : connection.status === "checking"
      ? "checking"
      : "unreachable";
  const offlineLabel = connection.online
    ? "Network online"
    : connection.status === "connected"
      ? "Local-only offline"
      : "Offline";
  const modeLabel = appMode === "standalone" ? "Standalone" : "Desktop";

  return [
    {
      id: "mode",
      label: modeLabel,
      tone: "neutral"
    },
    {
      id: "api",
      label: `${apiName} ${apiStatus}`,
      tone: apiTone(connection.status),
      title: connection.error ?? connection.version ?? `${apiName} ${apiStatus}`
    },
    {
      id: "network",
      label: offlineLabel,
      tone: networkTone(connection.online, connection.status)
    },
    {
      id: "search",
      label: searchStatusLabel(settings),
      tone: settings.webSearchMode === "off" ? "neutral" : "success"
    },
    {
      id: "memory",
      label: memoryStatusLabel(settings),
      tone: settings.enableRetrieval ? "success" : "neutral"
    }
  ];
}

function searchStatusLabel(settings: LocalSettings) {
  if (settings.webSearchMode === "off") return "Search off";

  const provider = settings.webSearchProvider === "off"
    ? "provider off"
    : settings.webSearchProvider;
  return `Search ${settings.webSearchMode}: ${provider}`;
}

function memoryStatusLabel(settings: LocalSettings) {
  if (!settings.enableRetrieval) return "Memory off";
  return `Memory ${settings.retrievalScope}`;
}

function apiTone(status: ReturnType<typeof useOllamaConnection>["status"]): StatusTone {
  if (status === "connected") return "success";
  if (status === "checking") return "warning";
  return "danger";
}

function networkTone(
  online: boolean,
  status: ReturnType<typeof useOllamaConnection>["status"]
): StatusTone {
  if (!online && status !== "connected") return "danger";
  if (!online) return "warning";
  return "neutral";
}

function RuntimeStatusText({
  label,
  tone,
  title
}: {
  label: string;
  tone: StatusTone;
  title?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap",
        tone === "neutral" && "text-muted-foreground",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "danger" && "text-danger"
      )}
      title={title ?? label}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full bg-current",
          tone === "warning" && "animate-pulse"
        )}
      />
      {label}
    </span>
  );
}
