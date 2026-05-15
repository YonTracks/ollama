"use client";

import { Box, ChevronDown, RefreshCcw } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { cn, formatBytes } from "@/lib/utils";
import type { OllamaModel } from "@/lib/ollama/types";

interface ModelSelectorProps {
  models: OllamaModel[];
  loading: boolean;
  error: string | null;
  selectedModel: string;
  onSelectModel(model: string): void;
  onRefreshModels(): void;
}

export function ModelSelector({
  models,
  loading,
  error,
  selectedModel,
  onSelectModel,
  onRefreshModels
}: ModelSelectorProps) {
  const selected = models.find((model) => model.name === selectedModel);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="sr-only" htmlFor="model-selector">
        Model
      </label>
      <div className="relative min-w-0 flex-1 sm:max-w-md">
        <select
          id="model-selector"
          value={selectedModel}
          onChange={(event) => onSelectModel(event.target.value)}
          disabled={loading && models.length === 0}
          className={cn(
            "h-10 w-full appearance-none rounded-md border border-border bg-panel-strong",
            "px-10 pr-9 text-sm text-foreground shadow-sm transition",
            "hover:border-muted-foreground/40 focus:focus-ring disabled:opacity-60"
          )}
        >
          {!selectedModel ? <option value="">Select a model</option> : null}
          {models.map((model) => (
            <option key={model.name} value={model.name}>
              {model.displayName}
              {model.local ? "" : " (pull on first chat)"}
            </option>
          ))}
        </select>
        <Box className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>

      <div className="hidden min-w-0 text-xs text-muted-foreground sm:block">
        {error ? (
          <span className="text-danger">Models unavailable</span>
        ) : selected ? (
          <span>{selected.local ? formatBytes(selected.size) : "Remote registry model"}</span>
        ) : loading ? (
          <span>Loading models</span>
        ) : (
          <span>No model selected</span>
        )}
      </div>

      <IconButton label="Refresh models" onClick={onRefreshModels}>
        <RefreshCcw className="h-4 w-4" />
      </IconButton>
    </div>
  );
}
