"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClientId } from "@/lib/utils";
import {
  deleteChat,
  getChat,
  getChats,
  renameChat,
  sendChat
} from "@/lib/ollama/client";
import {
  deleteStandaloneChat,
  getStandaloneChat,
  listStandaloneChats,
  renameStandaloneChat,
  saveStandaloneChat
} from "@/lib/ollama/standalone-db";
import { sendStandaloneChat } from "@/lib/ollama/standalone";
import type {
  Chat,
  ChatInfo,
  ChatMessage,
  ChatRequest,
  ChatTextEvent,
  DownloadEvent
} from "@/lib/ollama/types";
import type { AppMode } from "@/lib/appMode";
import type { LocalSettings } from "@/types/app";

interface UseChatOptions {
  chatId: string | null;
  mode: AppMode;
  coreApiBase?: string;
  selectedModel: string;
  settings: LocalSettings;
  enabled: boolean;
  onChatCreated(chatId: string): void;
  onRefreshNeeded(): void;
}

function appendAssistantDelta(
  messages: ChatMessage[],
  event: ChatTextEvent
) {
  const next = [...messages];
  const last = next.at(-1);
  const canUpdateLast = last?.role === "assistant" && last.status === "streaming";

  if (canUpdateLast && last) {
    next[next.length - 1] = {
      ...last,
      content: `${last.content}${event.content ?? ""}`,
      thinking: `${last.thinking ?? ""}${event.thinking ?? ""}`,
      thinkingTimeStart: event.thinkingTimeStart ?? last.thinkingTimeStart,
      thinkingTimeEnd: event.thinkingTimeEnd ?? last.thinkingTimeEnd,
      status: "streaming"
    };
    return next;
  }

  next.push({
    id: createClientId("assistant"),
    role: "assistant",
    content: event.content ?? "",
    thinking: event.thinking,
    thinkingTimeStart: event.thinkingTimeStart,
    thinkingTimeEnd: event.thinkingTimeEnd,
    status: "streaming"
  });
  return next;
}

function completeStreamingMessages(messages: ChatMessage[]) {
  return messages.map((message) =>
    message.status === "streaming" ? { ...message, status: "complete" as const } : message
  );
}

function toThinkRequest(settings: LocalSettings): ChatRequest["think"] {
  if (!settings.thinkEnabled) return false;
  return settings.thinkLevel === "none" ? true : settings.thinkLevel;
}

function createChatTitle(prompt: string) {
  const title = prompt.trim().replace(/\s+/g, " ");
  if (!title) return "New chat";
  return title.length > 64 ? `${title.slice(0, 61)}...` : title;
}

function completeChat(chat: Chat, messages: ChatMessage[]): Chat {
  return {
    ...chat,
    title:
      chat.title ||
      createChatTitle(messages.find((message) => message.role === "user")?.content ?? ""),
    messages,
    updatedAt: new Date().toISOString()
  };
}

export function useChatList(enabled: boolean, mode: AppMode) {
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) return;
      setLoading(true);
      setError(null);

      try {
        const response =
          mode === "standalone" ? await listStandaloneChats() : await getChats(signal);
        setChats(
          [...response.chatInfos].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )
        );
      } catch (refreshError) {
        const message =
          refreshError instanceof Error ? refreshError.message : "Failed to load conversations";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [enabled, mode]
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [enabled, refresh]);

  const rename = useCallback(
    async (chatId: string, title: string) => {
      if (mode === "standalone") {
        await renameStandaloneChat(chatId, title);
      } else {
        await renameChat(chatId, title);
      }
      await refresh();
    },
    [mode, refresh]
  );

  const remove = useCallback(
    async (chatId: string) => {
      if (mode === "standalone") {
        await deleteStandaloneChat(chatId);
      } else {
        await deleteChat(chatId);
      }
      await refresh();
    },
    [mode, refresh]
  );

  return { chats, loading, error, refresh, rename, remove };
}

export function useChatSession({
  chatId,
  mode,
  coreApiBase,
  selectedModel,
  settings,
  enabled,
  onChatCreated,
  onRefreshNeeded
}: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadEvent | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chatRef = useRef<Chat | null>(null);

  const loadChat = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled || !chatId) {
        setMessages([]);
        chatRef.current = null;
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response =
          mode === "standalone"
            ? await getStandaloneChat(chatId)
            : await getChat(chatId, signal);
        chatRef.current = response.chat;
        setMessages(response.chat.messages);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Failed to load chat";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [chatId, enabled, mode]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadChat(controller.signal);
    return () => controller.abort();
  }, [loadChat]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages((current) => {
      const next = completeStreamingMessages(current);
      if (mode === "standalone" && chatRef.current) {
        const nextChat = completeChat(chatRef.current, next);
        chatRef.current = nextChat;
        void saveStandaloneChat(nextChat);
      }
      return next;
    });
  }, [mode]);

  const send = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || !selectedModel || streaming) return;

      if (mode === "standalone") {
        const now = new Date().toISOString();
        const targetChatId = chatId ?? createClientId("chat");
        const controller = new AbortController();
        const userMessage: ChatMessage = {
          id: createClientId("user"),
          role: "user",
          content: trimmed,
          createdAt: now,
          updatedAt: now,
          status: "complete"
        };
        let workingMessages = [...messages, userMessage];
        const currentChat: Chat = completeChat(
          chatRef.current ?? {
            id: targetChatId,
            title: createChatTitle(trimmed),
            createdAt: now,
            updatedAt: now,
            messages: []
          },
          workingMessages
        );

        abortRef.current = controller;
        setError(null);
        setDownload(null);
        setStreaming(true);
        setMessages(workingMessages);
        chatRef.current = currentChat;

        try {
          await saveStandaloneChat(currentChat);
          if (!chatId) onChatCreated(targetChatId);
          onRefreshNeeded();

          for await (const event of sendStandaloneChat(
            coreApiBase,
            selectedModel,
            workingMessages,
            toThinkRequest(settings),
            controller.signal
          )) {
            if (event.eventName === "error") {
              setError(event.error);
              continue;
            }

            if (
              event.eventName === "chat" ||
              event.eventName === "thinking" ||
              event.eventName === "assistant_with_tools"
            ) {
              workingMessages = appendAssistantDelta(workingMessages, event);
              const nextChat = completeChat(currentChat, workingMessages);
              chatRef.current = nextChat;
              setMessages(workingMessages);
              await saveStandaloneChat(nextChat);
              continue;
            }

            if (event.eventName === "done") {
              workingMessages = completeStreamingMessages(workingMessages);
              const nextChat = completeChat(currentChat, workingMessages);
              chatRef.current = nextChat;
              setMessages(workingMessages);
              await saveStandaloneChat(nextChat);
            }
          }

          onRefreshNeeded();
        } catch (sendError) {
          if (controller.signal.aborted) return;
          const message = sendError instanceof Error ? sendError.message : "Failed to send message";
          workingMessages = [
            ...completeStreamingMessages(workingMessages),
            {
              id: createClientId("error"),
              role: "assistant",
              content: message,
              status: "error"
            }
          ];
          setError(message);
          setMessages(workingMessages);
          const nextChat = completeChat(currentChat, workingMessages);
          chatRef.current = nextChat;
          await saveStandaloneChat(nextChat);
          onRefreshNeeded();
        } finally {
          abortRef.current = null;
          setStreaming(false);
        }
        return;
      }

      const targetChatId = chatId ?? "new";
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setDownload(null);
      setStreaming(true);

      setMessages((current) => [
        ...current,
        {
          id: createClientId("user"),
          role: "user",
          content: trimmed,
          status: "complete"
        }
      ]);

      try {
        const request: ChatRequest = {
          model: selectedModel,
          prompt: trimmed,
          web_search: settings.webSearchEnabled,
          file_tools: false,
          think: toThinkRequest(settings)
        };

        for await (const event of sendChat(targetChatId, request, controller.signal)) {
          if (event.eventName === "chat_created" && event.chatId) {
            onChatCreated(event.chatId);
          }

          if (event.eventName === "download") {
            setDownload(event);
            continue;
          }

          if (event.eventName === "error") {
            setError(event.error);
            continue;
          }

          if (
            event.eventName === "chat" ||
            event.eventName === "thinking" ||
            event.eventName === "assistant_with_tools"
          ) {
            setMessages((current) => appendAssistantDelta(current, event));
            continue;
          }

          if (event.eventName === "tool" || event.eventName === "tool_result") {
            setMessages((current) => [
              ...current,
              {
                id: createClientId("tool"),
                role: "tool",
                content: event.content || `${event.toolName ?? "Tool"} finished`,
                toolName: event.toolName,
                status: "complete"
              }
            ]);
            continue;
          }

          if (event.eventName === "done") {
            setMessages((current) => completeStreamingMessages(current));
          }
        }

        onRefreshNeeded();
      } catch (sendError) {
        if (controller.signal.aborted) return;
        const message = sendError instanceof Error ? sendError.message : "Failed to send message";
        setError(message);
        setMessages((current) => [
          ...completeStreamingMessages(current),
          {
            id: createClientId("error"),
            role: "assistant",
            content: message,
            status: "error"
          }
        ]);
      } finally {
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [
      chatId,
      coreApiBase,
      messages,
      mode,
      onChatCreated,
      onRefreshNeeded,
      selectedModel,
      settings,
      streaming
    ]
  );

  return useMemo(
    () => ({
      messages,
      loading,
      streaming,
      error,
      download,
      reload: loadChat,
      send,
      stop
    }),
    [download, error, loadChat, loading, messages, send, stop, streaming]
  );
}
