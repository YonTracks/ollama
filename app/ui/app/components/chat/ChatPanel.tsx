"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  HardDriveDownload,
  Loader2,
  MessageCircle,
  WifiOff
} from "lucide-react";
import { MessageList } from "@/components/chat/MessageList";
import { PromptComposer } from "@/components/chat/PromptComposer";
import { useToast } from "@/components/ui/ToastProvider";
import { cn } from "@/lib/utils";
import type { useChatSession } from "@/hooks/useChats";
import type { useOllamaConnection } from "@/hooks/useOllamaConnection";
import type { ChatMessage } from "@/lib/ollama/types";
import type { LocalSettings } from "@/types/app";

interface ChatPanelProps {
  activeChatId: string | null;
  connection: ReturnType<typeof useOllamaConnection>;
  standalone?: boolean;
  selectedModel: string;
  settings: LocalSettings;
  chat: ReturnType<typeof useChatSession>;
  onUpdateSettings(updates: Partial<LocalSettings>): Promise<boolean | void> | boolean | void;
}

export function ChatPanel({
  activeChatId,
  connection,
  standalone = false,
  selectedModel,
  settings,
  chat,
  onUpdateSettings
}: ChatPanelProps) {
  const { showToast } = useToast();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const previousMessageCountRef = useRef(0);
  const previousErrorRef = useRef<string | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const disabledReason = connection.status !== "connected"
    ? connection.status === "offline"
      ? "Local Ollama unavailable"
      : "Disconnected"
    : !selectedModel
      ? "Select a model"
      : null;

  const visibleMessages = useMemo(
    () => withModelLoadingMessage(chat.messages, chat.modelLoadingName ?? selectedModel, chat.modelLoading),
    [chat.messages, chat.modelLoading, chat.modelLoadingName, selectedModel]
  );

  const lastMessage = visibleMessages.at(-1);
  const lastMessageSignal = useMemo(() => {
    if (!lastMessage) return "empty";
    return [
      lastMessage.id,
      lastMessage.content.length,
      lastMessage.attachments?.length ?? 0,
      lastMessage.thinking?.length ?? 0,
      lastMessage.status
    ].join(":");
  }, [lastMessage]);

  const isNearBottom = useCallback((element: HTMLDivElement) => {
    return element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = scrollContainerRef.current;
    if (!element) return;

    element.scrollTo({
      top: element.scrollHeight,
      behavior
    });
    setIsPinnedToBottom(true);
    setShowScrollButton(false);
  }, []);

  const handleScroll = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element) return;

    const nearBottom = isNearBottom(element);
    setIsPinnedToBottom(nearBottom);
    setShowScrollButton(!nearBottom && visibleMessages.length > 0);
  }, [isNearBottom, visibleMessages.length]);

  useEffect(() => {
    window.requestAnimationFrame(() => scrollToBottom("auto"));
  }, [activeChatId, scrollToBottom]);

  useEffect(() => {
    if (!chat.error) {
      previousErrorRef.current = null;
      return;
    }

    if (chat.error === previousErrorRef.current) return;
    previousErrorRef.current = chat.error;
    showToast({
      id: "chat-error",
      title: "Chat request failed",
      description: chat.error,
      tone: "danger",
      duration: 7000
    });
  }, [chat.error, showToast]);

  useEffect(() => {
    const previousMessageCount = previousMessageCountRef.current;
    const messageAdded = visibleMessages.length > previousMessageCount;
    previousMessageCountRef.current = visibleMessages.length;

    if (visibleMessages.length === 0) {
      setShowScrollButton(false);
      setIsPinnedToBottom(true);
      return;
    }

    const shouldForceNewUserMessageIntoView = messageAdded && lastMessage?.role === "user";
    if (isPinnedToBottom || shouldForceNewUserMessageIntoView) {
      window.requestAnimationFrame(() =>
        scrollToBottom(messageAdded ? "smooth" : "auto")
      );
    } else {
      setShowScrollButton(true);
    }
  }, [
    visibleMessages.length,
    isPinnedToBottom,
    lastMessage?.role,
    lastMessageSignal,
    scrollToBottom
  ]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="scrollbar-subtle h-full min-h-0 overflow-y-auto scroll-smooth"
        >
          {connection.status === "offline" && visibleMessages.length === 0 ? (
            <StatePanel
              icon={<WifiOff className="h-6 w-6" />}
              title="Local Ollama unavailable"
              body="The app shell is available offline. Chat will resume when the local Ollama API is reachable."
            />
          ) : connection.status === "disconnected" && visibleMessages.length === 0 ? (
            <StatePanel
              icon={<AlertTriangle className="h-6 w-6" />}
              title="Ollama is disconnected"
              body={connection.error ?? "The local server is not responding."}
            />
          ) : chat.loading && visibleMessages.length === 0 ? (
            <StatePanel
              icon={<Loader2 className="h-6 w-6 animate-spin" />}
              title="Loading chat"
              body="Fetching local conversation state."
            />
          ) : visibleMessages.length === 0 ? (
            <StatePanel
              icon={<MessageCircle className="h-6 w-6" />}
              title={activeChatId ? "Conversation is empty" : "New chat"}
              body="Pick a model and start locally."
            />
          ) : (
            <MessageList messages={visibleMessages} compact={settings.compactMessages} />
          )}
        </div>

        {showScrollButton ? (
          <button
            type="button"
            aria-label="Scroll to latest message"
            title="Scroll to latest message"
            onClick={() => scrollToBottom("smooth")}
            className="absolute bottom-4 left-1/2 z-10 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-panel-strong text-foreground shadow-panel transition hover:border-accent/45 hover:text-accent focus:focus-ring"
          >
            <ArrowDown className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      {chat.download ? (
        <div className="border-t border-border bg-panel px-4 py-3">
          <div className="mx-auto flex w-full max-w-4xl items-center gap-3 text-sm text-muted-foreground">
            <HardDriveDownload className="h-4 w-4 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center justify-between gap-3">
                <span>Downloading model</span>
                <span>{chat.download.done ? "Complete" : `${Math.round((chat.download.completed / Math.max(chat.download.total, 1)) * 100)}%`}</span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-accent transition-[width]"
                  style={{
                    width: `${Math.round((chat.download.completed / Math.max(chat.download.total, 1)) * 100)}%`
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {chat.error ? (
        <div className="border-t border-danger/25 bg-danger/10 px-4 py-2 text-sm text-danger">
          <div className="mx-auto max-w-4xl">{chat.error}</div>
        </div>
      ) : null}

      <PromptComposer
        selectedModel={selectedModel}
        settings={settings}
        disabledReason={disabledReason}
        webSearchAvailable
        streaming={chat.streaming}
        onSend={chat.send}
        onStop={() => {
          chat.stop();
          showToast({
            id: "chat-stopped",
            title: "Response stopped",
            description: "The current generation was cancelled.",
            tone: "info",
            duration: 2400
          });
        }}
        onUpdateSettings={onUpdateSettings}
      />
    </section>
  );
}

function withModelLoadingMessage(
  messages: ChatMessage[],
  model: string,
  modelLoading: boolean
) {
  if (!modelLoading) return messages;

  const hasPendingAssistant = messages.some(
    (message) =>
      message.role === "assistant" &&
      (message.status === "sending" || message.status === "streaming") &&
      !message.content &&
      !message.thinking &&
      (message.attachments?.length ?? 0) === 0
  );
  if (hasPendingAssistant) return messages;

  return [
    ...messages,
    {
      id: "model-loading",
      role: "assistant" as const,
      content: "",
      model,
      status: "sending" as const
    }
  ];
}

function StatePanel({
  icon,
  title,
  body
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div
        className={cn(
        "w-full max-w-[calc(100vw-2rem)] rounded-md border border-border bg-panel/80 p-6 text-center shadow-panel sm:max-w-md"
        )}
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-border bg-panel-strong text-accent">
          {icon}
        </div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 break-all text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
