"use client";

import { Globe2, Lightbulb, Send, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";
import type { LocalSettings } from "@/types/app";

interface PromptComposerProps {
  selectedModel: string;
  settings: LocalSettings;
  disabledReason: string | null;
  webSearchAvailable?: boolean;
  streaming: boolean;
  onSend(prompt: string): void;
  onStop(): void;
  onUpdateSettings(updates: Partial<LocalSettings>): void;
}

export function PromptComposer({
  selectedModel,
  settings,
  disabledReason,
  webSearchAvailable = true,
  streaming,
  onSend,
  onStop,
  onUpdateSettings
}: PromptComposerProps) {
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const disabled = Boolean(disabledReason);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [prompt]);

  const submit = () => {
    if (!prompt.trim() || disabled || streaming) return;
    onSend(prompt);
    setPrompt("");
  };

  return (
    <footer className="flex-none border-t border-border bg-background/90 px-3 py-3 backdrop-blur sm:px-4">
      <div className="mx-auto max-w-4xl">
        <div
          className={cn(
            "rounded-md border bg-panel shadow-panel transition",
            disabled ? "border-border opacity-75" : "border-border focus-within:border-accent/50"
          )}
        >
          <label className="sr-only" htmlFor="prompt">
            Message
          </label>
          <textarea
            ref={textareaRef}
            id="prompt"
            value={prompt}
            rows={1}
            disabled={disabled || streaming}
            placeholder={
              disabledReason ? disabledReason : `Message ${selectedModel || "Ollama"}`
            }
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="block max-h-44 min-h-14 w-full resize-none bg-transparent px-4 py-4 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />

          <div className="flex items-center gap-2 border-t border-border px-2 py-2">
            {webSearchAvailable ? (
              <button
                type="button"
                aria-pressed={settings.webSearchEnabled}
                onClick={() =>
                  onUpdateSettings({ webSearchEnabled: !settings.webSearchEnabled })
                }
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition focus:focus-ring",
                  settings.webSearchEnabled
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                <Globe2 className="h-4 w-4" />
                <span className="hidden sm:inline">Web</span>
              </button>
            ) : null}

            <button
              type="button"
              aria-pressed={settings.thinkEnabled}
              onClick={() => onUpdateSettings({ thinkEnabled: !settings.thinkEnabled })}
              className={cn(
                "flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition focus:focus-ring",
                settings.thinkEnabled
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <Lightbulb className="h-4 w-4" />
              <span className="hidden sm:inline">Think</span>
            </button>

            <select
              aria-label="Thinking level"
              value={settings.thinkLevel}
              disabled={!settings.thinkEnabled}
              onChange={(event) =>
                onUpdateSettings({
                  thinkLevel: event.target.value as LocalSettings["thinkLevel"]
                })
              }
              className="h-9 rounded-md border border-border bg-panel-strong px-2 text-sm text-muted-foreground outline-none transition focus:focus-ring disabled:opacity-50"
            >
              <option value="none">Auto</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>

            <div className="min-w-0 flex-1" />

            {streaming ? (
              <IconButton label="Stop response" onClick={onStop} variant="danger">
                <Square className="h-4 w-4 fill-current" />
              </IconButton>
            ) : (
              <IconButton
                label="Send message"
                onClick={submit}
                disabled={disabled || !prompt.trim()}
                variant="solid"
              >
                <Send className="h-4 w-4" />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
