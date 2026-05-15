import { parseJsonlResponse } from "./stream";
import { OllamaClientError } from "./client";
import type {
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  ChatTextEvent,
  OllamaModel,
  OllamaTagsResponse,
  OllamaVersion
} from "./types";

export const DEFAULT_CORE_API_BASE = "http://127.0.0.1:11434";

interface CoreChatChunk {
  model?: string;
  created_at?: string;
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
  };
  done?: boolean;
  error?: string;
}

interface CoreChatRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
  }>;
  stream: true;
  think?: ChatRequest["think"];
}

export function getCoreApiBase(configured?: string) {
  const runtimeConfigured = configured?.trim();
  if (runtimeConfigured) return runtimeConfigured.replace(/\/$/, "");

  const envConfigured = process.env.NEXT_PUBLIC_OLLAMA_CORE_API_BASE?.trim();
  if (envConfigured) return envConfigured.replace(/\/$/, "");

  return DEFAULT_CORE_API_BASE;
}

function coreUrl(path: string, apiBase?: string) {
  return `${getCoreApiBase(apiBase)}${path}`;
}

async function readError(response: Response) {
  const text = await response.text();
  if (!text) return response.statusText || "Request failed";

  try {
    const data = JSON.parse(text) as { error?: string; details?: string };
    return data.error || data.details || text;
  } catch {
    return text;
  }
}

function toStandaloneError(error: unknown) {
  if (error instanceof OllamaClientError) return error;
  if (error instanceof TypeError) {
    return new OllamaClientError(
      "Ollama is unreachable. Make sure `ollama serve` is running and browser origins are allowed.",
      { code: "unreachable" }
    );
  }
  if (error instanceof SyntaxError) {
    return new OllamaClientError("Ollama returned an unreadable response.", { code: "parse" });
  }
  if (error instanceof Error) return new OllamaClientError(error.message);
  return new OllamaClientError("An unknown Ollama error occurred.");
}

async function fetchCoreJson<T>(
  path: string,
  apiBase?: string,
  init?: RequestInit
): Promise<T> {
  try {
    const response = await fetch(coreUrl(path, apiBase), {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers
      }
    });

    if (!response.ok) {
      throw new OllamaClientError(await readError(response), {
        status: response.status,
        code: "http"
      });
    }

    return (await response.json()) as T;
  } catch (error) {
    throw toStandaloneError(error);
  }
}

function normalizeModelName(name: string) {
  return name.replace(/:latest$/, "");
}

function isVisibleModel(model: OllamaModel) {
  const families = model.details?.families;
  if (!families || families.length === 0) return true;
  return !families.every((family) => family.toLowerCase().includes("bert"));
}

export async function getStandaloneVersion(apiBase?: string, signal?: AbortSignal) {
  return fetchCoreJson<OllamaVersion>("/api/version", apiBase, { signal });
}

export async function listStandaloneModels(apiBase?: string, signal?: AbortSignal) {
  const data = await fetchCoreJson<OllamaTagsResponse>("/api/tags", apiBase, { signal });
  return (data.models ?? [])
    .map<OllamaModel>((model) => {
      const name = normalizeModelName(model.name || model.model || "");
      return {
        name,
        displayName: name,
        digest: model.digest,
        modifiedAt: model.modified_at,
        size: model.size,
        details: model.details,
        local: Boolean(model.digest)
      };
    })
    .filter((model) => model.name.length > 0)
    .filter(isVisibleModel);
}

function toCoreMessages(messages: ChatMessage[]): CoreChatRequest["messages"] {
  return messages
    .filter(
      (message) =>
        (message.role === "system" || message.role === "user" || message.role === "assistant") &&
        message.content.trim().length > 0
    )
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

function doneEvent(end?: string): ChatTextEvent {
  return {
    eventName: "done",
    thinkingTimeEnd: end
  };
}

export async function* sendStandaloneChat(
  apiBase: string | undefined,
  model: string,
  messages: ChatMessage[],
  think: ChatRequest["think"],
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent> {
  const request: CoreChatRequest = {
    model,
    messages: toCoreMessages(messages),
    stream: true,
    think
  };

  let response: Response;

  try {
    response = await fetch(coreUrl("/api/chat", apiBase), {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/x-ndjson, application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request),
      signal
    });
  } catch (error) {
    throw toStandaloneError(error);
  }

  if (!response.ok) {
    throw new OllamaClientError(await readError(response), {
      status: response.status,
      code: "http"
    });
  }

  let thinkingStart: string | undefined;
  let thinkingEnd: string | undefined;

  try {
    for await (const chunk of parseJsonlResponse<CoreChatChunk>(response)) {
      if (chunk.error) {
        yield { eventName: "error", error: chunk.error };
        continue;
      }

      const thinking = chunk.message?.thinking;
      if (thinking) {
        thinkingStart ??= new Date().toISOString();
        yield {
          eventName: "thinking",
          thinking,
          thinkingTimeStart: thinkingStart
        };
      }

      const content = chunk.message?.content;
      if (content) {
        if (thinkingStart && !thinkingEnd) {
          thinkingEnd = new Date().toISOString();
          yield {
            eventName: "thinking",
            thinking: "",
            thinkingTimeStart: thinkingStart,
            thinkingTimeEnd: thinkingEnd
          };
        }

        yield {
          eventName: "chat",
          content,
          thinkingTimeStart: thinkingStart,
          thinkingTimeEnd: thinkingEnd
        };
      }

      if (chunk.done) {
        if (thinkingStart && !thinkingEnd) thinkingEnd = new Date().toISOString();
        yield doneEvent(thinkingEnd);
      }
    }
  } catch (error) {
    throw toStandaloneError(error);
  }
}
