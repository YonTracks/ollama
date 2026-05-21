import { createClientId } from "@/lib/utils";
import { parseJsonlResponse } from "./stream";
import type {
  Chat,
  ChatAttachment,
  ChatInfo,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  ChatsResponse,
  CloudStatusResponse,
  CloudStatusSource,
  InferenceComputeResponse,
  OllamaModel,
  OllamaTagsResponse,
  OllamaUser,
  OllamaVersion,
  SecurityStatusResponse,
  Settings,
  SettingsResponse
} from "./types";

const DEV_API_BASE = "http://127.0.0.1:3001";
const OLLAMA_DOT_COM = "https://ollama.com";

interface RawChatMessage {
  role?: string;
  content?: string;
  attachments?: RawChatAttachment[];
  thinking?: string;
  thinkingTimeStart?: string;
  thinkingTimeEnd?: string;
  stream?: boolean;
  model?: string;
  tool_name?: string;
  stats?: unknown;
  contextNotice?: unknown;
  contextWarnings?: unknown;
  webSearchProvider?: string;
  webSearchResults?: unknown;
  webSearchError?: string;
  webSearchMode?: string;
  webSearchReason?: string;
  webSearchSearched?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface RawChatAttachment {
  filename?: string;
  name?: string;
  mimeType?: string;
  mime_type?: string;
  size?: number;
  data?: string;
  text?: string;
  truncated?: boolean;
}

interface RawChat {
  id?: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  messages?: RawChatMessage[];
}

interface RawChatResponse {
  chat?: RawChat;
}

interface UserStatusResponse {
  user?: OllamaUser | null;
  signin_url?: string;
}

export class OllamaClientError extends Error {
  readonly status?: number;
  readonly code: "http" | "unreachable" | "parse" | "unknown";

  constructor(message: string, options?: { status?: number; code?: OllamaClientError["code"] }) {
    super(message);
    this.name = "OllamaClientError";
    this.status = options?.status;
    this.code = options?.code ?? "unknown";
  }
}

export function getApiBase() {
  const configured = process.env.NEXT_PUBLIC_OLLAMA_API_BASE?.trim();
  if (configured) return configured.replace(/\/$/, "");

  if (process.env.NODE_ENV === "development") {
    return DEV_API_BASE;
  }

  return "";
}

function apiUrl(path: string) {
  return `${getApiBase()}${path}`;
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

function toClientError(error: unknown) {
  if (error instanceof OllamaClientError) return error;
  if (error instanceof TypeError) {
    return new OllamaClientError(
      "Ollama is unreachable. Make sure the local app server is running.",
      { code: "unreachable" }
    );
  }
  if (error instanceof SyntaxError) {
    return new OllamaClientError("Ollama returned an unreadable response.", { code: "parse" });
  }
  if (error instanceof Error) {
    return new OllamaClientError(error.message);
  }
  return new OllamaClientError("An unknown Ollama error occurred.");
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(apiUrl(path), {
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

    const text = await response.text();
    if (!text.trim()) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new OllamaClientError(
        "Ollama returned an unreadable JSON response. If you are using the static preview server, make sure it can proxy /api requests to the app backend.",
        { status: response.status, code: "parse" }
      );
    }
  } catch (error) {
    throw toClientError(error);
  }
}

function normalizeModelName(name: string) {
  return name.replace(/:latest$/, "");
}

function normalizeUser(user: OllamaUser): OllamaUser {
  return {
    ...user,
    avatarurl:
      user.avatarurl && !user.avatarurl.startsWith("http")
        ? `${OLLAMA_DOT_COM}${user.avatarurl}`
        : user.avatarurl
  };
}

function isVisibleModel(model: OllamaModel) {
  const families = model.details?.families;
  if (!families || families.length === 0) return true;
  return !families.every((family) => family.toLowerCase().includes("bert"));
}

function normalizeChatInfo(info: ChatInfo): ChatInfo {
  return {
    id: info.id,
    title: info.title || "Untitled chat",
    userExcerpt: info.userExcerpt || "",
    createdAt: info.createdAt,
    updatedAt: info.updatedAt
  };
}

function normalizeRole(role?: string): ChatMessage["role"] {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }
  return "assistant";
}

const IMAGE_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".mdx",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);

function extensionForName(name: string) {
  const match = /\.[^.]+$/.exec(name.toLowerCase());
  return match?.[0] ?? "";
}

function mimeTypeForName(name: string, fallback?: string) {
  if (fallback) return fallback;
  const extension = extensionForName(name);
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".md" || extension === ".mdx") return "text/markdown";
  if (TEXT_EXTENSIONS.has(extension)) return "text/plain";
  return "application/octet-stream";
}

function attachmentKind(name: string, mimeType: string): ChatAttachment["kind"] {
  if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(extensionForName(name))) {
    return "image";
  }
  if (mimeType.startsWith("text/") || TEXT_EXTENSIONS.has(extensionForName(name))) {
    return "text";
  }
  return "file";
}

function estimatedBase64Size(data?: string) {
  if (!data) return 0;
  return Math.max(0, Math.floor((data.replace(/=+$/, "").length * 3) / 4));
}

function decodeBase64Text(data?: string) {
  if (!data || typeof atob === "undefined") return undefined;

  try {
    const binary = atob(data);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

function encodeBase64Text(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function normalizeAttachments(
  attachments: RawChatAttachment[] | undefined,
  messageId: string
): ChatAttachment[] | undefined {
  if (!attachments?.length) return undefined;

  return attachments
    .map((attachment, index) => {
      const name = attachment.filename || attachment.name || `attachment-${index + 1}`;
      const mimeType = mimeTypeForName(name, attachment.mimeType || attachment.mime_type);
      const kind = attachmentKind(name, mimeType);
      const data = attachment.data;
      const text =
        attachment.text ?? (kind === "text" ? decodeBase64Text(attachment.data) : undefined);

      return {
        id: `${messageId}-attachment-${index}`,
        name,
        mimeType,
        size: attachment.size ?? estimatedBase64Size(data),
        kind,
        data,
        text,
        truncated: attachment.truncated
      };
    })
    .filter((attachment) => attachment.name.trim().length > 0);
}

function normalizeMessage(message: RawChatMessage, index: number): ChatMessage {
  const id = `${message.role ?? "message"}-${index}-${message.created_at ?? createClientId("msg")}`;

  return {
    id,
    role: normalizeRole(message.role),
    content: message.content ?? "",
    attachments: normalizeAttachments(message.attachments, id),
    thinking: message.thinking,
    thinkingTimeStart: message.thinkingTimeStart,
    thinkingTimeEnd: message.thinkingTimeEnd,
    model: message.model,
    stream: message.stream,
    toolName: message.tool_name,
    stats: normalizeResponseStats(message.stats),
    contextNotice: normalizeContextNotice(message.contextNotice),
    contextWarnings: normalizeContextWarnings(message.contextWarnings),
    webSearchProvider: normalizeSearchProvider(message.webSearchProvider),
    webSearchResults: normalizeSearchResults(message.webSearchResults),
    webSearchError: message.webSearchError,
    webSearchMode: normalizeSearchMode(message.webSearchMode),
    webSearchReason: message.webSearchReason,
    webSearchSearched: message.webSearchSearched,
    createdAt: message.created_at,
    updatedAt: message.updated_at,
    status: message.stream ? "streaming" : "complete"
  };
}

function normalizeSearchProvider(provider?: string) {
  if (
    provider === "off" ||
    provider === "brave" ||
    provider === "tavily" ||
    provider === "exa" ||
    provider === "ollama" ||
    provider === "custom"
  ) {
    return provider;
  }
  return undefined;
}

function normalizeSearchMode(mode?: string) {
  if (mode === "off" || mode === "manual" || mode === "auto") {
    return mode;
  }
  return undefined;
}

function normalizeSearchResults(results: unknown) {
  if (!Array.isArray(results)) return undefined;
  return results.filter((result) => {
    if (!result || typeof result !== "object") return false;
    const item = result as { url?: unknown; title?: unknown; content?: unknown };
    return typeof item.url === "string" && typeof item.title === "string" && typeof item.content === "string";
  }) as ChatMessage["webSearchResults"];
}

function normalizeResponseStats(stats: unknown) {
  if (!stats || typeof stats !== "object") return undefined;
  return stats as ChatMessage["stats"];
}

function normalizeContextNotice(notice: unknown) {
  if (!notice || typeof notice !== "object") return undefined;
  return notice as ChatMessage["contextNotice"];
}

function normalizeContextWarnings(warnings: unknown) {
  if (!Array.isArray(warnings)) return undefined;
  return warnings as ChatMessage["contextWarnings"];
}

function toDesktopAttachment(attachment: ChatAttachment) {
  return {
    filename: attachment.name,
    data:
      attachment.data ??
      (attachment.kind === "text" && attachment.text ? encodeBase64Text(attachment.text) : "")
  };
}

function toDesktopChatRequest(request: ChatRequest) {
  return {
    ...request,
    attachments: request.attachments?.map(toDesktopAttachment)
  };
}

function normalizeChat(chat?: RawChat): Chat {
  return {
    id: chat?.id ?? "",
    title: chat?.title || "New chat",
    createdAt: chat?.created_at,
    updatedAt: chat?.updated_at,
    messages: (chat?.messages ?? []).map(normalizeMessage)
  };
}

export async function getVersion(signal?: AbortSignal) {
  return fetchJson<OllamaVersion>("/api/version", { signal });
}

export async function listModels(signal?: AbortSignal): Promise<OllamaModel[]> {
  const data = await fetchJson<OllamaTagsResponse>("/api/tags", { signal });
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

export async function showModel(model: string, signal?: AbortSignal) {
  return fetchJson<Record<string, unknown>>("/api/show", {
    method: "POST",
    body: JSON.stringify({ model }),
    signal
  });
}

export async function getChats(signal?: AbortSignal): Promise<ChatsResponse> {
  const data = await fetchJson<ChatsResponse>("/api/v1/chats", { signal });
  return {
    chatInfos: (data.chatInfos ?? []).map(normalizeChatInfo)
  };
}

export async function getChat(chatId: string, signal?: AbortSignal): Promise<ChatResponse> {
  const data = await fetchJson<RawChatResponse>(`/api/v1/chat/${encodeURIComponent(chatId)}`, {
    signal
  });
  return {
    chat: normalizeChat(data.chat)
  };
}

export async function renameChat(chatId: string, title: string) {
  await fetchJson<ChatInfo>(`/api/v1/chat/${encodeURIComponent(chatId)}/rename`, {
    method: "PUT",
    body: JSON.stringify({ title })
  });
}

export async function deleteChat(chatId: string) {
  await fetchJson<void>(`/api/v1/chat/${encodeURIComponent(chatId)}`, {
    method: "DELETE"
  });
}

export async function deleteChatMessage(
  chatId: string,
  messageIndex: number
): Promise<ChatResponse> {
  const data = await fetchJson<RawChatResponse>(
    `/api/v1/chat/${encodeURIComponent(chatId)}/message/${messageIndex}`,
    {
      method: "DELETE"
    }
  );
  return {
    chat: normalizeChat(data.chat)
  };
}

export async function branchChat(
  chatId: string,
  messageIndex: number
): Promise<ChatResponse> {
  const data = await fetchJson<RawChatResponse>(
    `/api/v1/chat/${encodeURIComponent(chatId)}/branch`,
    {
      method: "POST",
      body: JSON.stringify({ messageIndex })
    }
  );
  return {
    chat: normalizeChat(data.chat)
  };
}

export async function deleteAllChats(): Promise<number> {
  const response = await getChats();
  await Promise.all(response.chatInfos.map((chat) => deleteChat(chat.id)));
  return response.chatInfos.length;
}

export async function getSettings(signal?: AbortSignal): Promise<SettingsResponse> {
  return fetchJson<SettingsResponse>("/api/v1/settings", { signal });
}

export async function updateSettings(settings: Settings): Promise<SettingsResponse> {
  return fetchJson<SettingsResponse>("/api/v1/settings", {
    method: "POST",
    body: JSON.stringify(settings)
  });
}

export async function getCloudStatus(signal?: AbortSignal): Promise<CloudStatusResponse> {
  const data = await fetchJson<CloudStatusResponse>("/api/v1/cloud", { signal });
  return {
    disabled: Boolean(data.disabled),
    source: normalizeCloudStatusSource(data.source)
  };
}

export async function getSecurityStatus(signal?: AbortSignal): Promise<SecurityStatusResponse> {
  const data = await fetchJson<SecurityStatusResponse>("/api/v1/security", { signal });
  return {
    ...data,
    cloudSource: normalizeCloudStatusSource(data.cloudSource),
    proxyAllowedUpstreams: Array.isArray(data.proxyAllowedUpstreams)
      ? data.proxyAllowedUpstreams
      : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : []
  };
}

export async function updateCloudSetting(enabled: boolean): Promise<CloudStatusResponse> {
  const data = await fetchJson<CloudStatusResponse>("/api/v1/cloud", {
    method: "POST",
    body: JSON.stringify({ enabled })
  });
  return {
    disabled: Boolean(data.disabled),
    source: normalizeCloudStatusSource(data.source)
  };
}

export async function fetchUser(signal?: AbortSignal): Promise<OllamaUser | null> {
  try {
    const response = await fetch(apiUrl("/api/v1/user"), {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json"
      },
      signal
    });

    if (!response.ok) {
      throw new OllamaClientError(await readError(response), {
        status: response.status,
        code: "http"
      });
    }

    const data = (await response.json()) as UserStatusResponse;
    return data.user ? normalizeUser(data.user) : null;
  } catch (error) {
    throw toClientError(error);
  }
}

export async function fetchConnectUrl(): Promise<string> {
  try {
    const response = await fetch(apiUrl("/api/v1/user"), {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new OllamaClientError(await readError(response), {
        status: response.status,
        code: "http"
      });
    }

    const data = (await response.json()) as UserStatusResponse;
    return data.signin_url ?? "";
  } catch (error) {
    throw toClientError(error);
  }
}

export async function disconnectUser(): Promise<void> {
  try {
    const response = await fetch(apiUrl("/api/signout"), {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new OllamaClientError(await readError(response), {
        status: response.status,
        code: "http"
      });
    }
  } catch (error) {
    throw toClientError(error);
  }
}

export async function getInferenceCompute(signal?: AbortSignal) {
  return fetchJson<InferenceComputeResponse>("/api/v1/inference-compute", { signal });
}

function normalizeCloudStatusSource(source?: string): CloudStatusSource {
  if (source === "env" || source === "config" || source === "both" || source === "none") {
    return source;
  }
  return "none";
}

export async function* sendChat(
  chatId: string,
  request: ChatRequest,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent> {
  let response: Response;

  try {
    response = await fetch(apiUrl(`/api/v1/chat/${encodeURIComponent(chatId)}`), {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "text/jsonl",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(toDesktopChatRequest(request)),
      signal
    });
  } catch (error) {
    throw toClientError(error);
  }

  if (!response.ok) {
    throw new OllamaClientError(await readError(response), {
      status: response.status,
      code: "http"
    });
  }

  try {
    yield* parseJsonlResponse<ChatStreamEvent>(response);
  } catch (error) {
    throw toClientError(error);
  }
}
