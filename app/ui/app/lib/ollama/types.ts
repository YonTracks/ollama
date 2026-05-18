import type { SearchProvider, SearchResult, WebSearchMode } from "@/lib/search/types";

export interface OllamaVersion {
  version: string;
}

export interface OllamaModelDetails {
  family?: string;
  families?: string[];
  format?: string;
  parameter_size?: string;
  quantization_level?: string;
}

export interface OllamaTagModel {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: OllamaModelDetails;
}

export interface OllamaTagsResponse {
  models?: OllamaTagModel[];
}

export interface OllamaModel {
  name: string;
  displayName: string;
  digest?: string;
  modifiedAt?: string;
  size?: number;
  details?: OllamaModelDetails;
  local: boolean;
}

export interface ChatInfo {
  id: string;
  title: string;
  userExcerpt: string;
  createdAt: string;
  updatedAt: string;
}

export type ChatAttachmentKind = "image" | "text" | "file";

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: ChatAttachmentKind;
  data?: string;
  text?: string;
  truncated?: boolean;
}

export interface OllamaUsageMetrics {
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  done_reason?: string;
}

export interface ResponseStats {
  outputTokens: number | null;
  promptTokens: number | null;
  contextUsed: number | null;
  contextLimit: number | null;
  contextPercent: number | null;
  outputTokensPerSecond: number | null;
  promptTokensPerSecond: number | null;
  totalSeconds: number | null;
  loadSeconds: number | null;
  doneReason?: string;
  raw?: OllamaUsageMetrics;
}

export type ContextManagementMode = "strict" | "friendly";
export type RetrievalMemoryScope = "current" | "selected" | "all";

export interface OllamaContextSettings {
  mode: ContextManagementMode;
  numCtx: number | null;
  numPredict: number | null;
  reserveOutputTokens: number;
  nearFullThresholdPercent: number;
  enableAutoSummarize: boolean;
  enableAutoTrim: boolean;
  enableRetrieval: boolean;
  retrievalScope: RetrievalMemoryScope;
  retrievalChatIds: string[];
  retrievalExcludedChatIds: string[];
  retrievalLimit: number;
  expertMode: boolean;
  expertInstructions: string;
  webSearchContext?: string;
}

export interface ContextNotice {
  mode: ContextManagementMode;
  action: "none" | "trimmed" | "summarized";
  omittedMessageCount?: number;
  estimatedOmittedTokens?: number;
  retrievedMemoryCount?: number;
  estimatedRetrievedTokens?: number;
  expertMode?: boolean;
  estimatedPromptTokensBefore?: number;
  estimatedPromptTokensAfter?: number;
  outputReserveTokens?: number;
}

export interface ContextWarning {
  kind:
    | "near-limit"
    | "full"
    | "possible-truncation"
    | "retrieved"
    | "trimmed"
    | "summarized"
    | "strict-input-too-long";
  message: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  attachments?: ChatAttachment[];
  thinking?: string;
  thinkingTimeStart?: string;
  thinkingTimeEnd?: string;
  model?: string;
  stream?: boolean;
  toolName?: string;
  createdAt?: string;
  updatedAt?: string;
  status?: "sending" | "streaming" | "complete" | "error";
  stats?: ResponseStats;
  contextNotice?: ContextNotice;
  contextWarnings?: ContextWarning[];
  webSearchProvider?: SearchProvider;
  webSearchResults?: SearchResult[];
  webSearchError?: string;
  webSearchMode?: WebSearchMode;
  webSearchReason?: string;
  webSearchSearched?: boolean;
}

export interface Chat {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  messages: ChatMessage[];
}

export interface ChatsResponse {
  chatInfos: ChatInfo[];
}

export interface ChatResponse {
  chat: Chat;
}

export interface ChatRequest {
  model: string;
  prompt: string;
  attachments?: ChatAttachment[];
  width?: number;
  height?: number;
  steps?: number;
  web_search?: boolean;
  file_tools?: boolean;
  forceUpdate?: boolean;
  think?: boolean | "low" | "medium" | "high";
  contextMode?: ContextManagementMode;
  numCtx?: number | null;
  numPredict?: number | null;
  reserveOutputTokens?: number;
  nearFullThresholdPercent?: number;
  enableAutoTrim?: boolean;
  enableAutoSummarize?: boolean;
  enableRetrieval?: boolean;
  retrievalScope?: RetrievalMemoryScope;
  retrievalChatIds?: string[];
  retrievalExcludedChatIds?: string[];
  retrievalLimit?: number;
  expertMode?: boolean;
  expertInstructions?: string;
  webSearchContext?: string;
  webSearchMode?: WebSearchMode;
  webSearchProvider?: SearchProvider;
  webSearchResults?: SearchResult[];
  webSearchError?: string;
  webSearchReason?: string;
  webSearchSearched?: boolean;
  estimatedPromptTokens?: number;
}

export interface ChatTextEvent {
  eventName:
    | "chat"
    | "thinking"
    | "assistant_with_tools"
    | "tool_call"
    | "tool"
    | "tool_result"
    | "done"
    | "chat_created";
  content?: string;
  thinking?: string;
  attachments?: ChatAttachment[];
  thinkingTimeStart?: string;
  thinkingTimeEnd?: string;
  chatId?: string;
  stats?: ResponseStats;
  contextNotice?: ContextNotice;
  contextWarnings?: ContextWarning[];
  toolName?: string;
  toolResult?: boolean;
  toolResultData?: unknown;
}

export interface DownloadEvent {
  eventName: "download";
  total: number;
  completed: number;
  done: boolean;
}

export interface ModelOperationEvent {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

export interface ErrorEvent {
  eventName: "error";
  error: string;
  code?: string;
  details?: string;
}

export type ChatStreamEvent = ChatTextEvent | DownloadEvent | ErrorEvent;

export interface Settings {
  Expose?: boolean;
  Browser?: boolean;
  Survey?: boolean;
  Models?: string;
  Agent?: boolean;
  Tools?: boolean;
  WorkingDir?: string;
  ContextLength?: number;
  TurboEnabled?: boolean;
  WebSearchEnabled?: boolean;
  ThinkEnabled?: boolean;
  ThinkLevel?: string;
  SelectedModel?: string;
  SidebarOpen?: boolean;
  LastHomeView?: string;
  AutoUpdateEnabled?: boolean;
}

export interface SettingsResponse {
  settings: Settings;
}

export type CloudStatusSource = "env" | "config" | "both" | "none";

export interface CloudStatusResponse {
  disabled: boolean;
  source: CloudStatusSource;
}

export interface OllamaUser {
  id?: string;
  email?: string;
  name?: string;
  bio?: string;
  avatarurl?: string;
  firstname?: string;
  lastname?: string;
  plan?: string;
}

export interface InferenceCompute {
  library: string;
  variant: string;
  compute: string;
  driver: string;
  name: string;
  vram: string;
}

export interface InferenceComputeResponse {
  inferenceComputes: InferenceCompute[];
  defaultContextLength: number;
}
