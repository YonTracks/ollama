import { parseJsonlResponse } from "./stream";
import { OllamaClientError } from "./client";
import { buildMessageContentWithAttachments, getImagePayloads } from "./attachments";
import { isImageGenerationModel } from "./models";
import {
  buildResponseStats,
  getOllamaContextLimit,
  hasUsageMetrics,
  usageMetricsFromChunk
} from "./stats";
import type {
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  ChatTextEvent,
  ModelOperationEvent,
  OllamaUsageMetrics,
  OllamaModel,
  OllamaTagsResponse,
  ResponseStats,
  OllamaVersion
} from "./types";

export const DEFAULT_CORE_API_BASE = "http://127.0.0.1:11434";
export const SAME_ORIGIN_CORE_API_BASE = "same-origin:";

interface CoreChatChunk extends OllamaUsageMetrics {
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

interface CoreGenerateChunk extends OllamaUsageMetrics {
  model?: string;
  created_at?: string;
  response?: string;
  thinking?: string;
  image?: string;
  completed?: number;
  total?: number;
  done?: boolean;
  error?: string;
}

interface CoreChatRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    images?: string[];
  }>;
  stream: true;
  think?: ChatRequest["think"];
}

interface CoreGenerateRequest {
  model: string;
  prompt: string;
  images?: string[];
  width?: number;
  height?: number;
  steps?: number;
  stream: true;
  think?: ChatRequest["think"];
}

export interface CreateStandaloneModelRequest {
  model: string;
  from?: string;
  files?: Record<string, string>;
  system?: string;
  parameters?: Record<string, string | number | boolean>;
  stream?: boolean;
}

type ImageGenerationOptions = Pick<ChatRequest, "width" | "height" | "steps">;

export function getCoreApiBase(configured?: string) {
  const runtimeConfigured = configured?.trim();
  if (runtimeConfigured === SAME_ORIGIN_CORE_API_BASE) return "";
  if (runtimeConfigured) return runtimeConfigured.replace(/\/$/, "");

  const envConfigured = process.env.NEXT_PUBLIC_OLLAMA_CORE_API_BASE?.trim();
  if (envConfigured) return envConfigured.replace(/\/$/, "");

  return DEFAULT_CORE_API_BASE;
}

function coreUrl(path: string, apiBase?: string) {
  const endpoint = path.replace(/^\/?api\/?/, "").replace(/^\/+/, "");
  return `${getCoreApiBase(apiBase)}/api/${endpoint}`;
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
      "Ollama is unreachable. Make sure `ollama serve` is running and the core API base is correct.",
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

function isChatUnsupportedError(message: string) {
  return /does not support chat/i.test(message);
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
    .map((message) => ({
      role: message.role,
      content: buildMessageContentWithAttachments(message.content, message.attachments),
      images: getImagePayloads(message.attachments)
    }))
    .filter(
      (message) =>
        (message.role === "system" || message.role === "user" || message.role === "assistant") &&
        (message.content.trim().length > 0 || (message.images?.length ?? 0) > 0)
    )
    .map((message) => ({
      ...message,
      images: message.images && message.images.length > 0 ? message.images : undefined
    }));
}

function doneEvent(end?: string, stats?: ResponseStats): ChatTextEvent {
  return {
    eventName: "done",
    thinkingTimeEnd: end,
    stats
  };
}

function imageAttachmentFromChunk(chunk: CoreGenerateChunk) {
  if (!chunk.image) return undefined;

  const timestamp = chunk.created_at ? new Date(chunk.created_at).getTime() : Date.now();
  return {
    id: `generated-image-${Number.isFinite(timestamp) ? timestamp : Date.now()}`,
    name: "generated-image.png",
    mimeType: "image/png",
    size: Math.ceil((chunk.image.length * 3) / 4),
    kind: "image" as const,
    data: chunk.image
  };
}

function latestUserMessage(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user");
}

async function postCore(
  path: string,
  apiBase: string | undefined,
  body: unknown,
  signal?: AbortSignal
) {
  try {
    return await fetch(coreUrl(path, apiBase), {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/x-ndjson, application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    throw toStandaloneError(error);
  }
}

async function statsFromFinalChunk(
  apiBase: string | undefined,
  model: string,
  chunk: OllamaUsageMetrics,
  fallbackNumCtx: number | null | undefined,
  signal?: AbortSignal
) {
  const metrics = usageMetricsFromChunk(chunk);
  if (!hasUsageMetrics(metrics)) return undefined;

  const contextLimit = await getOllamaContextLimit({
    baseUrl: getCoreApiBase(apiBase),
    model,
    fallbackNumCtx,
    signal
  });

  return buildResponseStats(metrics, contextLimit);
}

async function* streamCoreOperation(
  path: string,
  apiBase: string | undefined,
  body: unknown,
  signal?: AbortSignal
): AsyncGenerator<ModelOperationEvent> {
  const response = await postCore(path, apiBase, body, signal);

  if (!response.ok) {
    throw new OllamaClientError(await readError(response), {
      status: response.status,
      code: "http"
    });
  }

  try {
    for await (const event of parseJsonlResponse<ModelOperationEvent>(response)) {
      yield event;
    }
  } catch (error) {
    throw toStandaloneError(error);
  }
}

export function pullStandaloneModel(
  model: string,
  apiBase?: string,
  signal?: AbortSignal
) {
  return streamCoreOperation("/api/pull", apiBase, { model, stream: true }, signal);
}

export function createStandaloneModel(
  request: CreateStandaloneModelRequest,
  apiBase?: string,
  signal?: AbortSignal
) {
  return streamCoreOperation(
    "/api/create",
    apiBase,
    {
      ...request,
      stream: request.stream ?? true
    },
    signal
  );
}

export async function deleteStandaloneModel(
  model: string,
  apiBase?: string,
  signal?: AbortSignal
) {
  let response: Response;

  try {
    response = await fetch(coreUrl("/api/delete", apiBase), {
      method: "DELETE",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model }),
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
}

export async function standaloneBlobExists(
  digest: string,
  apiBase?: string,
  signal?: AbortSignal
) {
  try {
    const response = await fetch(coreUrl(`/api/blobs/${digest}`, apiBase), {
      method: "HEAD",
      cache: "no-store",
      signal
    });
    return response.ok;
  } catch (error) {
    throw toStandaloneError(error);
  }
}

export async function uploadStandaloneBlob(
  digest: string,
  file: Blob,
  apiBase?: string,
  signal?: AbortSignal
) {
  try {
    const response = await fetch(coreUrl(`/api/blobs/${digest}`, apiBase), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/octet-stream"
      },
      body: file,
      signal
    });

    if (!response.ok) {
      throw new OllamaClientError(await readError(response), {
        status: response.status,
        code: "http"
      });
    }
  } catch (error) {
    throw toStandaloneError(error);
  }
}

async function* sendStandaloneGenerate(
  apiBase: string | undefined,
  model: string,
  messages: ChatMessage[],
  think: ChatRequest["think"],
  imageOptions: ImageGenerationOptions = {},
  fallbackNumCtx?: number | null,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent> {
  const userMessage = latestUserMessage(messages);
  const prompt = buildMessageContentWithAttachments(
    userMessage?.content ?? "",
    userMessage?.attachments
  );
  const images = getImagePayloads(userMessage?.attachments);
  const request: CoreGenerateRequest = {
    model,
    prompt,
    images: images.length > 0 ? images : undefined,
    width: imageOptions.width,
    height: imageOptions.height,
    steps: imageOptions.steps,
    stream: true,
    think
  };

  const response = await postCore("/api/generate", apiBase, request, signal);

  if (!response.ok) {
    throw new OllamaClientError(await readError(response), {
      status: response.status,
      code: "http"
    });
  }

  let thinkingStart: string | undefined;
  let thinkingEnd: string | undefined;

  try {
    for await (const chunk of parseJsonlResponse<CoreGenerateChunk>(response)) {
      if (chunk.error) {
        yield { eventName: "error", error: chunk.error };
        continue;
      }

      if (chunk.thinking) {
        thinkingStart ??= new Date().toISOString();
        yield {
          eventName: "thinking",
          thinking: chunk.thinking,
          thinkingTimeStart: thinkingStart
        };
      }

      if (chunk.response) {
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
          content: chunk.response,
          thinkingTimeStart: thinkingStart,
          thinkingTimeEnd: thinkingEnd
        };
      }

      const imageAttachment = imageAttachmentFromChunk(chunk);
      if (imageAttachment) {
        yield {
          eventName: "chat",
          content: "",
          attachments: [imageAttachment]
        };
      }

      if (chunk.done) {
        if (thinkingStart && !thinkingEnd) thinkingEnd = new Date().toISOString();
        yield doneEvent(
          thinkingEnd,
          await statsFromFinalChunk(apiBase, model, chunk, fallbackNumCtx, signal)
        );
      }
    }
  } catch (error) {
    throw toStandaloneError(error);
  }
}

export async function* sendStandaloneChat(
  apiBase: string | undefined,
  model: string,
  messages: ChatMessage[],
  think: ChatRequest["think"],
  imageOptions: ImageGenerationOptions = {},
  fallbackNumCtx?: number | null,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent> {
  if (isImageGenerationModel(model)) {
    yield* sendStandaloneGenerate(
      apiBase,
      model,
      messages,
      think,
      imageOptions,
      fallbackNumCtx,
      signal
    );
    return;
  }

  const request: CoreChatRequest = {
    model,
    messages: toCoreMessages(messages),
    stream: true,
    think
  };

  const response = await postCore("/api/chat", apiBase, request, signal);

  if (!response.ok) {
    const errorMessage = await readError(response);
    if (isChatUnsupportedError(errorMessage)) {
      yield* sendStandaloneGenerate(
        apiBase,
        model,
        messages,
        think,
        imageOptions,
        fallbackNumCtx,
        signal
      );
      return;
    }

    throw new OllamaClientError(errorMessage, {
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
        yield doneEvent(
          thinkingEnd,
          await statsFromFinalChunk(apiBase, model, chunk, fallbackNumCtx, signal)
        );
      }
    }
  } catch (error) {
    throw toStandaloneError(error);
  }
}
