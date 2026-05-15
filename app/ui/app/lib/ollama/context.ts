import { buildMessageContentWithAttachments, getImagePayloads } from "./attachments";
import type {
  ChatMessage,
  ContextNotice,
  ContextWarning,
  OllamaContextSettings,
  ResponseStats
} from "./types";

const MESSAGE_OVERHEAD_TOKENS = 12;
const IMAGE_ATTACHMENT_TOKENS = 512;
const POSSIBLE_TRUNCATION_RATIO = 1.25;
const POSSIBLE_TRUNCATION_MIN_GAP = 512;

export interface ContextBudgetResult {
  estimatedPromptTokens: number;
  estimatedOutputReserve: number;
  estimatedTotalBeforeResponse: number;
  contextLimit: number | null;
  isNearLimit: boolean;
  wouldExceedLimit: boolean;
}

export interface PreparedContextPayload {
  messages: ChatMessage[];
  contextNotice: ContextNotice;
  budget: ContextBudgetResult;
}

export function normalizeContextSettings(
  settings: Partial<OllamaContextSettings> = {}
): OllamaContextSettings {
  return {
    mode: settings.mode ?? "friendly",
    numCtx: positiveNumberOrNull(settings.numCtx),
    numPredict: positiveNumberOrNull(settings.numPredict),
    reserveOutputTokens: Math.max(0, settings.reserveOutputTokens ?? 1024),
    nearFullThresholdPercent: clamp(settings.nearFullThresholdPercent ?? 85, 1, 100),
    enableAutoSummarize: Boolean(settings.enableAutoSummarize),
    enableAutoTrim: settings.enableAutoTrim ?? true
  };
}

export function estimateMessageTokens(message: ChatMessage): number {
  const content = buildMessageContentWithAttachments(message.content, message.attachments);
  const textTokens = approximateTokenCount(content);
  const thinkingTokens = message.thinking ? approximateTokenCount(message.thinking) : 0;
  const imageTokens = getImagePayloads(message.attachments).length * IMAGE_ATTACHMENT_TOKENS;

  return MESSAGE_OVERHEAD_TOKENS + textTokens + thinkingTokens + imageTokens;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return outboundMessages(messages).reduce(
    (total, message) => total + estimateMessageTokens(message),
    0
  );
}

export function calculateContextBudget(params: {
  messages: ChatMessage[];
  contextLimit: number | null;
  outputReserveTokens: number;
  nearFullThresholdPercent?: number;
}): ContextBudgetResult {
  const estimatedPromptTokens = estimateMessagesTokens(params.messages);
  const estimatedOutputReserve = Math.max(0, params.outputReserveTokens);
  const estimatedTotalBeforeResponse = estimatedPromptTokens + estimatedOutputReserve;
  const threshold = clamp(params.nearFullThresholdPercent ?? 85, 1, 100);

  return {
    estimatedPromptTokens,
    estimatedOutputReserve,
    estimatedTotalBeforeResponse,
    contextLimit: params.contextLimit,
    isNearLimit:
      typeof params.contextLimit === "number" &&
      estimatedTotalBeforeResponse >= params.contextLimit * (threshold / 100),
    wouldExceedLimit:
      typeof params.contextLimit === "number" &&
      estimatedTotalBeforeResponse > params.contextLimit
  };
}

export function prepareContextMessages(params: {
  messages: ChatMessage[];
  settings: OllamaContextSettings;
}): PreparedContextPayload {
  const settings = normalizeContextSettings(params.settings);
  const contextLimit = settings.numCtx;
  const beforeBudget = calculateContextBudget({
    messages: params.messages,
    contextLimit,
    outputReserveTokens: settings.reserveOutputTokens,
    nearFullThresholdPercent: settings.nearFullThresholdPercent
  });

  if (
    settings.mode !== "friendly" ||
    !settings.enableAutoTrim ||
    !contextLimit ||
    !beforeBudget.wouldExceedLimit
  ) {
    return {
      messages: params.messages,
      budget: beforeBudget,
      contextNotice: {
        mode: settings.mode,
        action: "none",
        estimatedPromptTokensBefore: beforeBudget.estimatedPromptTokens,
        estimatedPromptTokensAfter: beforeBudget.estimatedPromptTokens,
        outputReserveTokens: beforeBudget.estimatedOutputReserve
      }
    };
  }

  const preparedMessages = trimMessagesToBudget(
    params.messages,
    Math.max(0, contextLimit - settings.reserveOutputTokens)
  );
  const afterBudget = calculateContextBudget({
    messages: preparedMessages,
    contextLimit,
    outputReserveTokens: settings.reserveOutputTokens,
    nearFullThresholdPercent: settings.nearFullThresholdPercent
  });
  const beforeOutbound = outboundMessages(params.messages);
  const afterOutbound = new Set(outboundMessages(preparedMessages));
  const omittedMessages = beforeOutbound.filter((message) => !afterOutbound.has(message));
  const estimatedOmittedTokens = omittedMessages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0
  );

  return {
    messages: preparedMessages,
    budget: afterBudget,
    contextNotice: {
      mode: "friendly",
      action: omittedMessages.length > 0 ? "trimmed" : "none",
      omittedMessageCount: omittedMessages.length || undefined,
      estimatedOmittedTokens: estimatedOmittedTokens || undefined,
      estimatedPromptTokensBefore: beforeBudget.estimatedPromptTokens,
      estimatedPromptTokensAfter: afterBudget.estimatedPromptTokens,
      outputReserveTokens: afterBudget.estimatedOutputReserve
    }
  };
}

export function buildContextWarnings(params: {
  stats?: ResponseStats;
  contextNotice?: ContextNotice;
  settings?: Partial<OllamaContextSettings>;
}): ContextWarning[] {
  const warnings: ContextWarning[] = [];
  const threshold = clamp(params.settings?.nearFullThresholdPercent ?? 85, 1, 100);
  const stats = params.stats;
  const notice = params.contextNotice;

  if (
    typeof stats?.contextLimit === "number" &&
    typeof stats.contextUsed === "number" &&
    stats.contextUsed >= stats.contextLimit
  ) {
    warnings.push({
      kind: "full",
      message: "Context is full. New responses may need more context or a shorter prompt."
    });
  } else if (
    typeof stats?.contextPercent === "number" &&
    stats.contextPercent >= threshold
  ) {
    warnings.push({
      kind: "near-limit",
      message: "Near context limit. Consider increasing context or trimming older messages."
    });
  }

  if (notice?.action === "trimmed") {
    warnings.push({
      kind: "trimmed",
      message: `${notice.omittedMessageCount ?? "Some"} older message${
        notice.omittedMessageCount === 1 ? "" : "s"
      } omitted to fit the selected context.`
    });
  }

  if (notice?.action === "summarized") {
    warnings.push({
      kind: "summarized",
      message: "Older messages were summarized to fit the selected context."
    });
  }

  const estimatedPromptTokens =
    notice?.estimatedPromptTokensAfter ?? notice?.estimatedPromptTokensBefore;
  const contextUnderPressure =
    typeof stats?.contextLimit === "number" &&
    typeof stats.contextPercent === "number" &&
    stats.contextPercent >= threshold;
  const appManagedContext =
    notice?.action === "trimmed" || notice?.action === "summarized";
  if (
    contextUnderPressure &&
    !appManagedContext &&
    typeof estimatedPromptTokens === "number" &&
    typeof stats?.promptTokens === "number" &&
    estimatedPromptTokens > stats.promptTokens * POSSIBLE_TRUNCATION_RATIO &&
    estimatedPromptTokens - stats.promptTokens >= POSSIBLE_TRUNCATION_MIN_GAP
  ) {
    warnings.push({
      kind: "possible-truncation",
      message:
        "Ollama processed fewer prompt tokens than the app estimated while near the context limit. Some context may have been truncated or omitted."
    });
  }

  return uniqueWarnings(warnings);
}

export function strictContextWarning(errorMessage: string): ContextWarning | null {
  if (!/context|token|truncate|shift|too long|exceed/i.test(errorMessage)) return null;

  return {
    kind: "strict-input-too-long",
    message:
      "Strict context mode blocked this request because it did not fit in the active context window. Increase context, shorten the prompt, or switch to friendly mode."
  };
}

function trimMessagesToBudget(messages: ChatMessage[], promptBudget: number) {
  const outbound = outboundMessages(messages);
  const latestUserIndex = findLatestUserIndex(outbound);
  const required = new Set<ChatMessage>();

  outbound.forEach((message) => {
    if (message.role === "system") required.add(message);
  });

  if (latestUserIndex >= 0) required.add(outbound[latestUserIndex]);

  const selected = new Set(required);
  let selectedTokens = [...selected].reduce(
    (total, message) => total + estimateMessageTokens(message),
    0
  );

  for (let index = outbound.length - 1; index >= 0; index--) {
    const message = outbound[index];
    if (selected.has(message)) continue;

    const tokens = estimateMessageTokens(message);
    if (selectedTokens + tokens <= promptBudget) {
      selected.add(message);
      selectedTokens += tokens;
    }
  }

  return messages.filter((message) => !outbound.includes(message) || selected.has(message));
}

function outboundMessages(messages: ChatMessage[]) {
  return messages.filter((message) => {
    if (message.role !== "system" && message.role !== "user" && message.role !== "assistant") {
      return false;
    }

    return (
      message.content.trim().length > 0 ||
      (message.attachments?.length ?? 0) > 0 ||
      (message.thinking?.trim().length ?? 0) > 0
    );
  });
}

function findLatestUserIndex(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") return index;
  }

  return -1;
}

function approximateTokenCount(text: string) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function positiveNumberOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function uniqueWarnings(warnings: ContextWarning[]) {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    if (seen.has(warning.kind)) return false;
    seen.add(warning.kind);
    return true;
  });
}
