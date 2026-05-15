"use client";

import { Bot, Cpu, User } from "lucide-react";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/ollama/types";

interface MessageListProps {
  messages: ChatMessage[];
  compact: boolean;
}

export function MessageList({ messages, compact }: MessageListProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6">
      {messages.map((message) => (
        <article
          key={message.id}
          className={cn(
            "group grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3",
            compact ? "py-1" : "py-3"
          )}
        >
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-md border",
              message.role === "user" && "border-accent/35 bg-accent/15 text-accent",
              message.role === "assistant" && "border-border bg-panel-strong text-foreground",
              message.role === "tool" && "border-warning/30 bg-warning/10 text-warning",
              message.status === "error" && "border-danger/30 bg-danger/10 text-danger"
            )}
          >
            {message.role === "user" ? (
              <User className="h-4 w-4" />
            ) : message.role === "tool" ? (
              <Cpu className="h-4 w-4" />
            ) : (
              <Bot className="h-4 w-4" />
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-1 flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium capitalize text-foreground/90">
                {message.role === "tool" ? message.toolName || "Tool" : message.role}
              </span>
              {message.model ? <span>{message.model}</span> : null}
              {message.status === "streaming" ? (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">
                  Streaming
                </span>
              ) : null}
            </div>

            {message.thinking ? (
              <details className="mb-3 rounded-md border border-border bg-panel px-3 py-2 text-sm text-muted-foreground">
                <summary className="cursor-pointer text-xs font-medium text-foreground">
                  {thinkingSummary(message)}
                </summary>
                <MarkdownContent
                  content={message.thinking}
                  className="mt-3 text-sm leading-6 text-muted-foreground"
                />
              </details>
            ) : null}

            <div
              className={cn(
                "break-words text-[15px] leading-7",
                message.role === "user" &&
                  "rounded-md border border-accent/20 bg-accent/10 px-4 py-3",
                message.role === "tool" &&
                  "rounded-md border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-muted-foreground",
                message.status === "error" && "text-danger"
              )}
            >
              {message.content ? <MarkdownContent content={message.content} /> : null}
              {message.status === "streaming" ? (
                <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-accent align-text-bottom" />
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function thinkingSummary(message: ChatMessage) {
  const duration = formatThinkingDuration(
    message.thinkingTimeStart,
    message.thinkingTimeEnd
  );

  if (duration) return `Thought for ${duration}`;
  return message.status === "streaming" ? "Thinking..." : "Thinking";
}

function formatThinkingDuration(start?: string, end?: string) {
  if (!start || !end) return null;

  const durationMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
