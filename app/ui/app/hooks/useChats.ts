"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClientId } from "@/lib/utils";
import {
  branchChat,
  deleteChat,
  deleteChatMessage,
  getChat,
  getChats,
  renameChat,
  sendChat
} from "@/lib/ollama/client";
import {
  branchStandaloneChat,
  deleteStandaloneChat,
  deleteStandaloneChatMessage,
  getStandaloneChat,
  listStandaloneChats,
  renameStandaloneChat,
  saveStandaloneChat
} from "@/lib/ollama/standalone-db";
import { sendStandaloneChat } from "@/lib/ollama/standalone";
import { buildContextWarnings, strictContextWarning } from "@/lib/ollama/context";
import { isImageGenerationModel } from "@/lib/ollama/models";
import { buildWebSearchContext, fetchSearchResults } from "@/lib/search/client";
import { resolveWebSearchDecision } from "@/lib/search/mode";
import { webSearchQueryForPrompt } from "@/lib/search/query";
import type { SearchProvider, SearchResult, WebSearchMode } from "@/lib/search/types";
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
  coreApiToken?: string;
  selectedModel: string;
  settings: LocalSettings;
  enabled: boolean;
  onChatCreated(chatId: string): void;
  onRefreshNeeded(): void;
}

interface SendOptions {
  replaceFromIndex?: number;
}

interface ActiveChatStream {
  id: string;
  chatId: string | null;
  messages: ChatMessage[];
  modelLoading: boolean;
  modelLoadingName: string | null;
  error: string | null;
  download: DownloadEvent | null;
}

type ActiveChatStreams = Record<string, ActiveChatStream>;

// Streams keep their own transient messages so switching chats cannot redirect
// async deltas into whichever conversation is currently visible.
function selectedStream(
  streams: ActiveChatStreams,
  chatId: string | null,
  activeNewStreamId: string | null
) {
  if (chatId) {
    return Object.values(streams).find((stream) => stream.chatId === chatId) ?? null;
  }

  return activeNewStreamId ? streams[activeNewStreamId] ?? null : null;
}

function streamMatchesSelection(
  stream: ActiveChatStream,
  chatId: string | null,
  activeNewStreamId: string | null
) {
  return chatId ? stream.chatId === chatId : stream.id === activeNewStreamId;
}

function streamingChatIds(streams: ActiveChatStreams) {
  return Object.values(streams)
    .map((stream) => stream.chatId)
    .filter((chatId): chatId is string => Boolean(chatId));
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
  const content =
    event.content ?? (event.eventName === "tool" ? "" : `${toolName} finished`);

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
              attachments: mergeAttachments(message.attachments, event.attachments),
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
      attachments: event.attachments,
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
  contextWarnings?: ContextWarning[],
  webSearch?: WebSearchState
): ChatMessage {
  return {
    id: createClientId("assistant"),
    role: "assistant",
    content: "",
    model,
    status: "sending",
    contextNotice,
    contextWarnings,
    webSearchMode: webSearch?.mode,
    webSearchProvider: webSearch?.provider,
    webSearchResults: webSearch?.results.length ? webSearch.results : undefined,
    webSearchError: webSearch?.error,
    webSearchReason: webSearch?.reason,
    webSearchSearched: webSearch?.searched
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

interface WebSearchState {
  mode: WebSearchMode;
  provider: SearchProvider;
  results: SearchResult[];
  context: string;
  reason: string;
  searched: boolean;
  error?: string;
}

function toContextSettings(
  settings: LocalSettings,
  webSearchContext = ""
): OllamaContextSettings {
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
    retrievalExcludedChatIds: settings.retrievalExcludedChatIds,
    retrievalLimit: settings.retrievalLimit,
    expertMode: settings.expertMode,
    expertInstructions: settings.expertInstructions,
    webSearchContext
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

async function resolveWebSearchContext(
  prompt: string,
  settings: LocalSettings,
  history: ChatMessage[] = [],
  signal?: AbortSignal
): Promise<WebSearchState | null> {
  if (!prompt.trim()) return null;

  const decision = resolveWebSearchDecision(prompt, {
    mode: settings.webSearchMode,
    manualEnabled: settings.webSearchEnabled
  });
  if (!decision.shouldSearch) {
    return {
      mode: decision.mode,
      provider: settings.webSearchProvider,
      results: [],
      context: "",
      reason: decision.reason,
      searched: false
    };
  }

  try {
    const searchQuery = webSearchQueryForPrompt(prompt, history);
    const response = await fetchSearchResults(searchQuery, {
      provider: settings.webSearchProvider,
      signal
    });
    if (response.disabled) {
      return {
        mode: decision.mode,
        provider: response.provider,
        results: [],
        context: "",
        reason: decision.reason,
        searched: false,
        error: "Web search is enabled, but the selected provider is off."
      };
    }
    if (response.error) {
      return {
        mode: decision.mode,
        provider: response.provider,
        results: [],
        context: "",
        reason: decision.reason,
        searched: false,
        error: response.error
      };
    }
    return {
      mode: decision.mode,
      provider: response.provider,
      results: response.results,
      context: buildWebSearchContext(response.results),
      reason: decision.reason,
      searched: true
    };
  } catch (error) {
    return {
      mode: decision.mode,
      provider: settings.webSearchProvider,
      results: [],
      context: "",
      reason: decision.reason,
      searched: false,
      error: error instanceof Error ? error.message : "Web search failed."
    };
  }
}

function attachWebSearchToLastAssistant(
  messages: ChatMessage[],
  webSearch: WebSearchState | null
) {
  if (!webSearch) return messages;

  const index = [...messages].reverse().findIndex((message) => message.role === "assistant");
  if (index < 0) return messages;
  const messageIndex = messages.length - 1 - index;

  return messages.map((message, currentIndex) =>
    currentIndex === messageIndex
      ? {
          ...message,
          webSearchMode: webSearch.mode,
          webSearchProvider: webSearch.provider,
          webSearchResults: webSearch.results.length ? webSearch.results : undefined,
          webSearchError: webSearch.error,
          webSearchReason: webSearch.reason,
          webSearchSearched: webSearch.searched
        }
      : message
  );
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

function findPreviousUserIndex(messages: ChatMessage[], startIndex: number) {
  for (let index = startIndex; index >= 0; index--) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
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
  coreApiToken,
  selectedModel,
  settings,
  enabled,
  onChatCreated,
  onRefreshNeeded
}: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStreams, setActiveStreams] = useState<ActiveChatStreams>({});
  const [activeNewStreamId, setActiveNewStreamId] = useState<string | null>(null);
  const activeStreamsRef = useRef<ActiveChatStreams>({});
  const activeNewStreamIdRef = useRef<string | null>(null);
  const abortRefs = useRef<Record<string, AbortController>>({});
  const chatIdRef = useRef<string | null>(chatId);
  const chatRef = useRef<Chat | null>(null);
  const activeStream = useMemo(
    () => selectedStream(activeStreams, chatId, activeNewStreamId),
    [activeNewStreamId, activeStreams, chatId]
  );
  const visibleMessages = activeStream?.messages ?? messages;
  const streaming = Boolean(activeStream);
  const modelLoading = activeStream?.modelLoading ?? false;
  const modelLoadingName = activeStream?.modelLoadingName ?? null;
  const download = activeStream?.download ?? null;
  const currentError = activeStream?.error ?? error;
  const streamingIds = useMemo(() => streamingChatIds(activeStreams), [activeStreams]);

  // Async stream callbacks need the latest selection, not the chatId captured
  // when a request started.
  useEffect(() => {
    chatIdRef.current = chatId;
    if (chatId && activeNewStreamIdRef.current) {
      activeNewStreamIdRef.current = null;
      setActiveNewStreamId(null);
    }
  }, [chatId]);

  useEffect(() => {
    activeStreamsRef.current = activeStreams;
  }, [activeStreams]);

  useEffect(() => {
    activeNewStreamIdRef.current = activeNewStreamId;
  }, [activeNewStreamId]);

  const addActiveStream = useCallback((stream: ActiveChatStream) => {
    setActiveStreams((current) => {
      const next = { ...current, [stream.id]: stream };
      activeStreamsRef.current = next;
      return next;
    });
  }, []);

  const updateActiveStream = useCallback(
    (streamId: string, updater: (stream: ActiveChatStream) => ActiveChatStream) => {
      setActiveStreams((current) => {
        const stream = current[streamId];
        if (!stream) return current;
        const next = { ...current, [streamId]: updater(stream) };
        activeStreamsRef.current = next;
        return next;
      });
    },
    []
  );

  const finishActiveStream = useCallback((streamId: string, finalMessages: ChatMessage[]) => {
    const stream = activeStreamsRef.current[streamId];
    if (!stream) return;

    if (
      streamMatchesSelection(
        stream,
        chatIdRef.current,
        activeNewStreamIdRef.current
      )
    ) {
      setMessages(finalMessages);
    }

    setActiveStreams((current) => {
      if (!current[streamId]) return current;
      const next = { ...current };
      delete next[streamId];
      activeStreamsRef.current = next;
      return next;
    });

    delete abortRefs.current[streamId];
    if (activeNewStreamIdRef.current === streamId) {
      activeNewStreamIdRef.current = null;
      setActiveNewStreamId(null);
    }
  }, []);

  const loadChat = useCallback(
    async (signal?: AbortSignal) => {
      // The stream map is the source of truth while that chat is in flight;
      // loading persisted history here would hide the live placeholder/result.
      if (
        selectedStream(
          activeStreamsRef.current,
          chatId,
          activeNewStreamIdRef.current
        )
      ) {
        setLoading(false);
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
    [chatId, enabled, mode]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadChat(controller.signal);
    return () => controller.abort();
  }, [loadChat]);

  const stop = useCallback(() => {
    const stream = selectedStream(
      activeStreamsRef.current,
      chatIdRef.current,
      activeNewStreamIdRef.current
    );
    if (!stream) return;

    abortRefs.current[stream.id]?.abort();
    const nextMessages = completeActiveMessages(stream.messages);

    if (mode === "standalone" && chatRef.current) {
      const nextChat = completeChat(chatRef.current, nextMessages);
      chatRef.current = nextChat;
      void saveStandaloneChat(nextChat);
    }

    finishActiveStream(stream.id, nextMessages);
  }, [finishActiveStream, mode]);

  const detachNewChatStream = useCallback(() => {
    activeNewStreamIdRef.current = null;
    setActiveNewStreamId(null);
  }, []);

  const send = useCallback(
    async (
      prompt: string,
      attachments: ChatAttachment[] = [],
      options: SendOptions = {}
    ) => {
      const trimmed = prompt.trim();
      const ownedStream = selectedStream(
        activeStreamsRef.current,
        chatIdRef.current,
        activeNewStreamIdRef.current
      );
      if ((!trimmed && attachments.length === 0) || !selectedModel || ownedStream) return;

      const replaceFromIndex =
        typeof options.replaceFromIndex === "number" && options.replaceFromIndex >= 0
          ? options.replaceFromIndex
          : undefined;
      const baseMessages =
        replaceFromIndex === undefined ? messages : messages.slice(0, replaceFromIndex);
      const streamId = createClientId("stream");
      const controller = new AbortController();
      abortRefs.current[streamId] = controller;
      setError(null);

      if (mode === "standalone") {
        const now = new Date().toISOString();
        const targetChatId = chatId ?? createClientId("chat");
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
          ...baseMessages,
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

        if (!chatId) {
          activeNewStreamIdRef.current = streamId;
          setActiveNewStreamId(streamId);
        }

        const initialStream: ActiveChatStream = {
          id: streamId,
          chatId: targetChatId,
          messages: workingMessages,
          modelLoading: true,
          modelLoadingName: selectedModel,
          error: null,
          download: null
        };
        addActiveStream(initialStream);

        const syncActiveChatRef = (chat: Chat) => {
          const stream = activeStreamsRef.current[streamId] ?? initialStream;
          if (
            streamMatchesSelection(
              stream,
              chatIdRef.current,
              activeNewStreamIdRef.current
            )
          ) {
            chatRef.current = chat;
          }
        };
        syncActiveChatRef(currentChat);

        try {
          await saveStandaloneChat(currentChat);
          if (
            !chatId &&
            streamMatchesSelection(
              initialStream,
              chatIdRef.current,
              activeNewStreamIdRef.current
            )
          ) {
            onChatCreated(targetChatId);
          }
          onRefreshNeeded();

          const webSearch = await resolveWebSearchContext(
            trimmed,
            settings,
            baseMessages,
            controller.signal
          );
          workingMessages = attachWebSearchToLastAssistant(workingMessages, webSearch);
          updateActiveStream(streamId, (stream) => ({
            ...stream,
            messages: workingMessages
          }));
          const contextSettings = toContextSettings(settings, webSearch?.context ?? "");

          for await (const event of sendStandaloneChat(
            coreApiBase,
            selectedModel,
            workingMessages,
            toThinkRequest(settings, selectedModel),
            toImageGenerationOptions(settings),
            contextSettings.numCtx,
            contextSettings,
            controller.signal,
            coreApiToken
          )) {
            if (event.eventName === "error") {
              const contextError = contextErrorMessage(event.error, settings);
              workingMessages = appendAssistantError(
                workingMessages,
                contextError.message,
                contextError.warnings
              );
              const nextChat = completeChat(currentChat, workingMessages);
              syncActiveChatRef(nextChat);
              updateActiveStream(streamId, (stream) => ({
                ...stream,
                messages: workingMessages,
                modelLoading: false,
                modelLoadingName: null,
                error: contextError.message
              }));
              await saveStandaloneChat(nextChat);
              continue;
            }

            if (
              event.eventName === "chat" ||
              event.eventName === "thinking" ||
              event.eventName === "assistant_with_tools"
            ) {
              workingMessages = appendAssistantDelta(workingMessages, event);
              const nextChat = completeChat(
                currentChat,
                persistableMessages(workingMessages)
              );
              syncActiveChatRef(nextChat);
              updateActiveStream(streamId, (stream) => ({
                ...stream,
                messages: workingMessages,
                modelLoading: false,
                modelLoadingName: null
              }));
              await saveStandaloneChat(nextChat);
              continue;
            }

            if (event.eventName === "done") {
              workingMessages = completeActiveMessages(
                workingMessages,
                event.stats,
                event.contextNotice,
                event.contextWarnings
              );
              const nextChat = completeChat(currentChat, workingMessages);
              syncActiveChatRef(nextChat);
              updateActiveStream(streamId, (stream) => ({
                ...stream,
                messages: workingMessages,
                modelLoading: false,
                modelLoadingName: null
              }));
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
          const nextChat = completeChat(currentChat, workingMessages);
          syncActiveChatRef(nextChat);
          updateActiveStream(streamId, (stream) => ({
            ...stream,
            messages: workingMessages,
            modelLoading: false,
            modelLoadingName: null,
            error: contextError.message
          }));
          await saveStandaloneChat(nextChat);
          onRefreshNeeded();
        } finally {
          finishActiveStream(streamId, workingMessages);
        }
        return;
      }

      const targetChatId = chatId ?? "new";
      if (!chatId) {
        activeNewStreamIdRef.current = streamId;
        setActiveNewStreamId(streamId);
      }

      let workingMessages: ChatMessage[] = [
        ...baseMessages,
        {
          id: createClientId("user"),
          role: "user",
          content: trimmed,
          attachments: attachments.length > 0 ? attachments : undefined,
          status: "complete"
        },
        createPendingAssistantMessage(selectedModel)
      ];

      addActiveStream({
        id: streamId,
        chatId,
        messages: workingMessages,
        modelLoading: true,
        modelLoadingName: selectedModel,
        error: null,
        download: null
      });

      try {
        const webSearch = await resolveWebSearchContext(
          trimmed,
          settings,
          baseMessages,
          controller.signal
        );
        workingMessages = attachWebSearchToLastAssistant(workingMessages, webSearch);
        updateActiveStream(streamId, (stream) => ({
          ...stream,
          messages: workingMessages
        }));
        const contextSettings = toContextSettings(settings, webSearch?.context ?? "");
        const request: ChatRequest = {
          model: selectedModel,
          prompt: trimmed,
          index: replaceFromIndex,
          attachments,
          ...toImageGenerationOptions(settings),
          web_search: false,
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
          retrievalExcludedChatIds: contextSettings.retrievalExcludedChatIds,
          retrievalLimit: contextSettings.retrievalLimit,
          expertMode: contextSettings.expertMode,
          expertInstructions: contextSettings.expertInstructions,
          webSearchContext: contextSettings.webSearchContext,
          webSearchMode: webSearch?.mode,
          webSearchProvider: webSearch?.provider,
          webSearchResults: webSearch?.results.length ? webSearch.results : undefined,
          webSearchError: webSearch?.error,
          webSearchReason: webSearch?.reason,
          webSearchSearched: webSearch?.searched
        };

        for await (const event of sendChat(targetChatId, request, controller.signal)) {
          if (event.eventName === "chat_created" && event.chatId) {
            // Brand-new chats only steal focus if the user is still looking at
            // the same new-chat stream that created them.
            const shouldSelectCreatedChat =
              !chatId &&
              streamMatchesSelection(
                activeStreamsRef.current[streamId] ?? {
                  id: streamId,
                  chatId: null,
                  messages: workingMessages,
                  modelLoading: false,
                  modelLoadingName: null,
                  error: null,
                  download: null
                },
                chatIdRef.current,
                activeNewStreamIdRef.current
              );
            updateActiveStream(streamId, (stream) => ({
              ...stream,
              chatId: event.chatId ?? stream.chatId
            }));
            if (shouldSelectCreatedChat) onChatCreated(event.chatId);
            onRefreshNeeded();
          }

          if (event.eventName === "download") {
            updateActiveStream(streamId, (stream) => ({
              ...stream,
              download: event
            }));
            continue;
          }

          if (event.eventName === "loading") {
            updateActiveStream(streamId, (stream) => ({
              ...stream,
              modelLoading: true,
              modelLoadingName: selectedModel
            }));
            continue;
          }

          if (event.eventName === "error") {
            const contextError = contextErrorMessage(event.error, settings);
            workingMessages = appendAssistantError(
              workingMessages,
              contextError.message,
              contextError.warnings
            );
            updateActiveStream(streamId, (stream) => ({
              ...stream,
              messages: workingMessages,
              modelLoading: false,
              modelLoadingName: null,
              error: contextError.message
            }));
            continue;
          }

          if (
            event.eventName === "chat" ||
            event.eventName === "thinking" ||
            event.eventName === "assistant_with_tools"
          ) {
            workingMessages = appendAssistantDelta(workingMessages, event);
            updateActiveStream(streamId, (stream) => ({
              ...stream,
              messages: workingMessages,
              modelLoading: false,
              modelLoadingName: null
            }));
            continue;
          }

          if (event.eventName === "tool" || event.eventName === "tool_result") {
            workingMessages = applyToolEvent(workingMessages, event);
            updateActiveStream(streamId, (stream) => ({
              ...stream,
              messages: workingMessages,
              modelLoading: false,
              modelLoadingName: null
            }));
            continue;
          }

          if (event.eventName === "done") {
            workingMessages = completeActiveMessages(
              workingMessages,
              event.stats,
              event.contextNotice,
              event.contextWarnings
            );
            updateActiveStream(streamId, (stream) => ({
              ...stream,
              messages: workingMessages,
              modelLoading: false,
              modelLoadingName: null
            }));
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
        updateActiveStream(streamId, (stream) => ({
          ...stream,
          messages: workingMessages,
          modelLoading: false,
          modelLoadingName: null,
          error: contextError.message
        }));
      } finally {
        finishActiveStream(streamId, workingMessages);
      }
    },
    [
      addActiveStream,
      chatId,
      coreApiBase,
      coreApiToken,
      finishActiveStream,
      messages,
      mode,
      onChatCreated,
      onRefreshNeeded,
      selectedModel,
      settings,
      updateActiveStream
    ]
  );

  const retryFromMessage = useCallback(
    async (messageId: string) => {
      if (streaming) return false;
      const messageIndex = visibleMessages.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) {
        throw new Error("Message was not found.");
      }

      const userIndex = findPreviousUserIndex(visibleMessages, messageIndex);
      if (userIndex < 0) {
        throw new Error("No user prompt was found to retry.");
      }

      const userMessage = visibleMessages[userIndex];
      await send(userMessage.content, userMessage.attachments ?? [], {
        replaceFromIndex: userIndex
      });
      return true;
    },
    [send, streaming, visibleMessages]
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (streaming) return false;
      const messageIndex = visibleMessages.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) {
        throw new Error("Message was not found.");
      }

      if (!chatId) {
        setMessages((current) => current.filter((message) => message.id !== messageId));
        return true;
      }

      const response =
        mode === "standalone"
          ? await deleteStandaloneChatMessage(chatId, messageIndex)
          : await deleteChatMessage(chatId, messageIndex);
      chatRef.current = response.chat;
      setMessages(response.chat.messages);
      onRefreshNeeded();
      return true;
    },
    [chatId, mode, onRefreshNeeded, streaming, visibleMessages]
  );

  const branchFromMessage = useCallback(
    async (messageId: string) => {
      if (streaming) return null;
      if (!chatId) {
        throw new Error("Save the conversation before branching it.");
      }

      const messageIndex = visibleMessages.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) {
        throw new Error("Message was not found.");
      }

      const response =
        mode === "standalone"
          ? await branchStandaloneChat(chatId, messageIndex)
          : await branchChat(chatId, messageIndex);
      onChatCreated(response.chat.id);
      onRefreshNeeded();
      return response.chat.id;
    },
    [chatId, mode, onChatCreated, onRefreshNeeded, streaming, visibleMessages]
  );

  return useMemo(
    () => ({
      messages: visibleMessages,
      loading,
      streaming,
      modelLoading,
      modelLoadingName,
      error: currentError,
      download,
      streamingChatIds: streamingIds,
      reload: loadChat,
      send,
      retryFromMessage,
      deleteMessage,
      branchFromMessage,
      stop,
      detachNewChatStream
    }),
    [
      currentError,
      detachNewChatStream,
      download,
      loadChat,
      loading,
      modelLoading,
      modelLoadingName,
      send,
      retryFromMessage,
      deleteMessage,
      branchFromMessage,
      stop,
      streaming,
      streamingIds,
      visibleMessages
    ]
  );
}
