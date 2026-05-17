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
import { buildContextWarnings, strictContextWarning } from "@/lib/ollama/context";
import { isImageGenerationModel } from "@/lib/ollama/models";
import type {
  Chat,
  ChatAttachment,
  ChatInfo,
  ChatMessage,
  ChatRequest,
  ChatTextEvent,
  ContextNotice,
  ContextWarning,
  DownloadEvent,
  OllamaContextSettings,
  ResponseStats
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
  const canUpdateLast =
    last?.role === "assistant" &&
    (last.status === "sending" || last.status === "streaming");

  if (canUpdateLast && last) {
    next[next.length - 1] = {
      ...last,
      content: `${last.content}${event.content ?? ""}`,
      attachments: mergeAttachments(last.attachments, event.attachments),
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
    attachments: event.attachments,
    thinking: event.thinking,
    thinkingTimeStart: event.thinkingTimeStart,
    thinkingTimeEnd: event.thinkingTimeEnd,
    status: "streaming"
  });
  return next;
}

function applyToolEvent(messages: ChatMessage[], event: ChatTextEvent) {
  const toolName = event.toolName ?? "Tool";
  const content = event.content || `${toolName} finished`;

  if (event.eventName === "tool_result") {
    const pendingIndex = [...messages]
      .reverse()
      .findIndex(
        (message) =>
          message.role === "tool" &&
          message.status === "streaming" &&
          (message.toolName ?? "Tool") === toolName
      );

    if (pendingIndex >= 0) {
      const messageIndex = messages.length - 1 - pendingIndex;
      return messages.map((message, index) =>
        index === messageIndex
          ? {
              ...message,
              content,
              toolName,
              status: "complete" as const
            }
          : message
      );
    }
  }

  return [
    ...messages,
    {
      id: createClientId("tool"),
      role: "tool" as const,
      content,
      toolName,
      status: event.eventName === "tool" ? "streaming" as const : "complete" as const
    }
  ];
}

function mergeAttachments(
  current: ChatAttachment[] | undefined,
  incoming: ChatAttachment[] | undefined
) {
  if (!incoming || incoming.length === 0) return current;
  return [...(current ?? []), ...incoming];
}

function createPendingAssistantMessage(
  model: string,
  contextNotice?: ContextNotice,
  contextWarnings?: ContextWarning[]
): ChatMessage {
  return {
    id: createClientId("assistant"),
    role: "assistant",
    content: "",
    model,
    status: "sending",
    contextNotice,
    contextWarnings
  };
}

function isEmptyPendingAssistantMessage(message: ChatMessage) {
  return (
    message.role === "assistant" &&
    message.status === "sending" &&
    message.content.trim().length === 0 &&
    (message.attachments?.length ?? 0) === 0 &&
    (message.thinking?.trim().length ?? 0) === 0
  );
}

function completeActiveMessages(
  messages: ChatMessage[],
  stats?: ResponseStats,
  contextNotice?: ContextNotice,
  contextWarnings?: ContextWarning[]
) {
  const next = messages
    .filter((message) => !isEmptyPendingAssistantMessage(message))
    .map((message) =>
      message.status === "sending" || message.status === "streaming"
        ? { ...message, status: "complete" as const }
        : message
    );

  return stats || contextNotice || contextWarnings
    ? attachResponseMetadataToLastAssistant(next, {
        stats,
        contextNotice,
        contextWarnings
      })
    : next;
}

function persistableMessages(messages: ChatMessage[]) {
  return messages.filter((message) => !isEmptyPendingAssistantMessage(message));
}

function appendAssistantError(
  messages: ChatMessage[],
  content: string,
  contextWarnings?: ContextWarning[]
) {
  const next = completeActiveMessages(messages);
  const last = next.at(-1);

  if (last?.role === "assistant" && last.status === "error") {
    return next.map((message, index) =>
      index === next.length - 1 ? { ...message, content, contextWarnings } : message
    );
  }

  return [
    ...next,
    {
      id: createClientId("error"),
      role: "assistant" as const,
      content,
      status: "error" as const,
      contextWarnings
    }
  ];
}

function attachResponseMetadataToLastAssistant(
  messages: ChatMessage[],
  metadata: {
    stats?: ResponseStats;
    contextNotice?: ContextNotice;
    contextWarnings?: ContextWarning[];
  }
) {
  const index = [...messages].reverse().findIndex((message) => message.role === "assistant");
  if (index < 0) return messages;

  const assistantIndex = messages.length - 1 - index;
  return messages.map((message, messageIndex) => {
    if (messageIndex !== assistantIndex) return message;

    const stats = metadata.stats ?? message.stats;
    const contextNotice = metadata.contextNotice ?? message.contextNotice;
    const contextWarnings =
      metadata.contextWarnings ??
      buildContextWarnings({
        stats,
        contextNotice
      });

    return {
      ...message,
      stats,
      contextNotice,
      contextWarnings: contextWarnings.length > 0 ? contextWarnings : undefined
    };
  });
}

function toThinkRequest(settings: LocalSettings, model?: string): ChatRequest["think"] {
  if (isImageGenerationModel(model)) return false;
  if (!settings.thinkEnabled) return false;
  return settings.thinkLevel === "none" ? true : settings.thinkLevel;
}

function toImageGenerationOptions(settings: LocalSettings) {
  return {
    width: settings.imageGenerationWidth,
    height: settings.imageGenerationHeight,
    steps: settings.imageGenerationSteps
  };
}

function toContextSettings(settings: LocalSettings): OllamaContextSettings {
  return {
    mode: settings.contextMode,
    numCtx: settings.contextLength > 0 ? settings.contextLength : null,
    numPredict: settings.maxOutputTokens > 0 ? settings.maxOutputTokens : null,
    reserveOutputTokens: settings.reserveOutputTokens,
    nearFullThresholdPercent: settings.nearFullThresholdPercent,
    enableAutoSummarize: settings.enableAutoSummarize,
    enableAutoTrim: settings.enableAutoTrim,
    enableRetrieval: settings.enableRetrieval,
    retrievalScope: settings.retrievalScope,
    retrievalChatIds: settings.retrievalChatIds,
    retrievalLimit: settings.retrievalLimit,
    expertMode: settings.expertMode,
    expertInstructions: settings.expertInstructions
  };
}

function contextErrorMessage(errorMessage: string, settings: LocalSettings) {
  const warning =
    settings.contextMode === "strict" ? strictContextWarning(errorMessage) : null;
  return {
    message: warning?.message ?? errorMessage,
    warnings: warning ? [warning] : undefined
  };
}

function createChatTitle(prompt: string, attachments: ChatAttachment[] = []) {
  const title = prompt.trim().replace(/\s+/g, " ");
  if (!title && attachments.length > 0) {
    const firstAttachment = attachments[0];
    const suffix = attachments.length > 1 ? ` +${attachments.length - 1}` : "";
    const attachmentTitle = `${firstAttachment.name}${suffix}`;
    return attachmentTitle.length > 64
      ? `${attachmentTitle.slice(0, 61)}...`
      : attachmentTitle;
  }
  if (!title) return "New chat";
  return title.length > 64 ? `${title.slice(0, 61)}...` : title;
}

function completeChat(chat: Chat, messages: ChatMessage[]): Chat {
  return {
    ...chat,
    title:
      chat.title ||
      createChatTitle(
        messages.find((message) => message.role === "user")?.content ?? "",
        messages.find((message) => message.role === "user")?.attachments
      ),
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
  const [modelLoading, setModelLoading] = useState(false);
  const [modelLoadingName, setModelLoadingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadEvent | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chatRef = useRef<Chat | null>(null);
  const optimisticChatIdRef = useRef<string | null>(null);

  const loadChat = useCallback(
    async (signal?: AbortSignal) => {
      if (streaming && chatId && chatId === optimisticChatIdRef.current) {
        return;
      }

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
    [chatId, enabled, mode, streaming]
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
    setModelLoading(false);
    setModelLoadingName(null);
    setMessages((current) => {
      const next = completeActiveMessages(current);
      if (mode === "standalone" && chatRef.current) {
        const nextChat = completeChat(chatRef.current, next);
        chatRef.current = nextChat;
        void saveStandaloneChat(nextChat);
      }
      return next;
    });
  }, [mode]);

  const send = useCallback(
    async (prompt: string, attachments: ChatAttachment[] = []) => {
      const trimmed = prompt.trim();
      if ((!trimmed && attachments.length === 0) || !selectedModel || streaming) return;

      if (mode === "standalone") {
        const now = new Date().toISOString();
        const targetChatId = chatId ?? createClientId("chat");
        const controller = new AbortController();
        const contextSettings = toContextSettings(settings);
        const userMessage: ChatMessage = {
          id: createClientId("user"),
          role: "user",
          content: trimmed,
          attachments: attachments.length > 0 ? attachments : undefined,
          createdAt: now,
          updatedAt: now,
          status: "complete"
        };
        let workingMessages = [
          ...messages,
          userMessage,
          createPendingAssistantMessage(selectedModel)
        ];
        const currentChat: Chat = completeChat(
          chatRef.current ?? {
            id: targetChatId,
            title: createChatTitle(trimmed, attachments),
            createdAt: now,
            updatedAt: now,
            messages: []
          },
          persistableMessages(workingMessages)
        );

        abortRef.current = controller;
        setError(null);
        setDownload(null);
        setModelLoading(true);
        setModelLoadingName(selectedModel);
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
            toThinkRequest(settings, selectedModel),
            toImageGenerationOptions(settings),
            contextSettings.numCtx,
            contextSettings,
            controller.signal
          )) {
            if (event.eventName === "error") {
              const contextError = contextErrorMessage(event.error, settings);
              setModelLoading(false);
              setModelLoadingName(null);
              setError(contextError.message);
              workingMessages = appendAssistantError(
                workingMessages,
                contextError.message,
                contextError.warnings
              );
              const nextChat = completeChat(currentChat, workingMessages);
              chatRef.current = nextChat;
              setMessages(workingMessages);
              await saveStandaloneChat(nextChat);
              continue;
            }

            if (
              event.eventName === "chat" ||
              event.eventName === "thinking" ||
              event.eventName === "assistant_with_tools"
            ) {
              setModelLoading(false);
              setModelLoadingName(null);
              workingMessages = appendAssistantDelta(workingMessages, event);
              const nextChat = completeChat(
                currentChat,
                persistableMessages(workingMessages)
              );
              chatRef.current = nextChat;
              setMessages(workingMessages);
              await saveStandaloneChat(nextChat);
              continue;
            }

            if (event.eventName === "done") {
              setModelLoading(false);
              setModelLoadingName(null);
              workingMessages = completeActiveMessages(
                workingMessages,
                event.stats,
                event.contextNotice,
                event.contextWarnings
              );
              const nextChat = completeChat(currentChat, workingMessages);
              chatRef.current = nextChat;
              setMessages(workingMessages);
              await saveStandaloneChat(nextChat);
            }
          }

          onRefreshNeeded();
        } catch (sendError) {
          if (controller.signal.aborted) return;
          const rawMessage = sendError instanceof Error ? sendError.message : "Failed to send message";
          const contextError = contextErrorMessage(rawMessage, settings);
          workingMessages = appendAssistantError(
            workingMessages,
            contextError.message,
            contextError.warnings
          );
          setError(contextError.message);
          setMessages(workingMessages);
          const nextChat = completeChat(currentChat, workingMessages);
          chatRef.current = nextChat;
          await saveStandaloneChat(nextChat);
          onRefreshNeeded();
        } finally {
          abortRef.current = null;
          setModelLoading(false);
          setModelLoadingName(null);
          setStreaming(false);
        }
        return;
      }

      const targetChatId = chatId ?? "new";
      const controller = new AbortController();
      optimisticChatIdRef.current = null;
      abortRef.current = controller;
      setError(null);
      setDownload(null);
      setModelLoading(true);
      setModelLoadingName(selectedModel);
      setStreaming(true);

      setMessages((current) => [
        ...current,
        {
          id: createClientId("user"),
          role: "user",
          content: trimmed,
          attachments: attachments.length > 0 ? attachments : undefined,
          status: "complete"
        },
        createPendingAssistantMessage(selectedModel)
      ]);

      try {
        const contextSettings = toContextSettings(settings);
        const request: ChatRequest = {
          model: selectedModel,
          prompt: trimmed,
          attachments,
          ...toImageGenerationOptions(settings),
          web_search: settings.webSearchEnabled,
          file_tools: false,
          think: toThinkRequest(settings, selectedModel),
          contextMode: contextSettings.mode,
          numCtx: contextSettings.numCtx,
          numPredict: contextSettings.numPredict,
          reserveOutputTokens: contextSettings.reserveOutputTokens,
          nearFullThresholdPercent: contextSettings.nearFullThresholdPercent,
          enableAutoTrim: contextSettings.enableAutoTrim,
          enableAutoSummarize: contextSettings.enableAutoSummarize,
          enableRetrieval: contextSettings.enableRetrieval,
          retrievalScope: contextSettings.retrievalScope,
          retrievalChatIds: contextSettings.retrievalChatIds,
          retrievalLimit: contextSettings.retrievalLimit,
          expertMode: contextSettings.expertMode,
          expertInstructions: contextSettings.expertInstructions
        };

        for await (const event of sendChat(targetChatId, request, controller.signal)) {
          if (event.eventName === "chat_created" && event.chatId) {
            optimisticChatIdRef.current = event.chatId;
            onChatCreated(event.chatId);
            onRefreshNeeded();
          }

          if (event.eventName === "download") {
            setDownload(event);
            continue;
          }

          if (event.eventName === "error") {
            const contextError = contextErrorMessage(event.error, settings);
            setModelLoading(false);
            setModelLoadingName(null);
            setError(contextError.message);
            setMessages((current) =>
              appendAssistantError(current, contextError.message, contextError.warnings)
            );
            continue;
          }

          if (
            event.eventName === "chat" ||
            event.eventName === "thinking" ||
            event.eventName === "assistant_with_tools"
          ) {
            setModelLoading(false);
            setModelLoadingName(null);
            setMessages((current) => appendAssistantDelta(current, event));
            continue;
          }

          if (event.eventName === "tool" || event.eventName === "tool_result") {
            setModelLoading(false);
            setModelLoadingName(null);
            setMessages((current) => applyToolEvent(current, event));
            continue;
          }

          if (event.eventName === "done") {
            setModelLoading(false);
            setModelLoadingName(null);
            setMessages((current) =>
              completeActiveMessages(
                current,
                event.stats,
                event.contextNotice,
                event.contextWarnings
              )
            );
          }
        }

        onRefreshNeeded();
      } catch (sendError) {
        if (controller.signal.aborted) return;
        const rawMessage = sendError instanceof Error ? sendError.message : "Failed to send message";
        const contextError = contextErrorMessage(rawMessage, settings);
        setError(contextError.message);
        setModelLoading(false);
        setModelLoadingName(null);
        setMessages((current) =>
          appendAssistantError(current, contextError.message, contextError.warnings)
        );
      } finally {
        abortRef.current = null;
        setModelLoading(false);
        setModelLoadingName(null);
        setStreaming(false);
        optimisticChatIdRef.current = null;
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
      modelLoading,
      modelLoadingName,
      error,
      download,
      reload: loadChat,
      send,
      stop
    }),
    [
      download,
      error,
      loadChat,
      loading,
      messages,
      modelLoading,
      modelLoadingName,
      send,
      stop,
      streaming
    ]
  );
}
