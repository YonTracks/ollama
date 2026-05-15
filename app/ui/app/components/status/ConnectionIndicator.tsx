"use client";

import { Circle, Server, WifiOff } from "lucide-react";
import type { useOllamaConnection } from "@/hooks/useOllamaConnection";
import { cn } from "@/lib/utils";

interface ConnectionIndicatorProps {
  connection: ReturnType<typeof useOllamaConnection>;
}

export function ConnectionIndicator({ connection }: ConnectionIndicatorProps) {
  const connected = connection.status === "connected";
  const offline = connection.status === "offline";
  const checking = connection.status === "checking";

  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-md border px-3 text-sm",
        connected && "border-success/30 bg-success/10 text-success",
        checking && "border-warning/30 bg-warning/10 text-warning",
        !connected && !checking && "border-danger/30 bg-danger/10 text-danger"
      )}
      title={connection.error ?? connection.version ?? "Ollama connection"}
    >
      {offline ? <WifiOff className="h-4 w-4" /> : <Server className="h-4 w-4" />}
      <span className="hidden lg:inline">
        {connected ? `Ollama ${connection.version ?? ""}` : checking ? "Checking" : "Disconnected"}
      </span>
      <Circle className={cn("h-2 w-2 fill-current", checking && "animate-pulse")} />
    </div>
  );
}
