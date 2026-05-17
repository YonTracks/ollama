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
const SUMMARY_MESSAGE_ID = "context-summary";
const RETRIEVAL_MESSAGE_ID = "context-retrieval";
const EXPERT_MESSAGE_ID = "context-expert";
const SUMMARY_MIN_TOKENS = 24;
const SUMMARY_MAX_TOKENS = 512;
const RETRIEVAL_MAX_TOKENS = 640;
const RETRIEVAL_SNIPPET_MAX_CHARACTERS = 320;
const DEFAULT_RETRIEVAL_LIMIT = 4;
const MAX_RETRIEVAL_LIMIT = 8;
const DEFAULT_EXPERT_INSTRUCTIONS =
  "Act as a careful domain expert. Use retrieved memory when it is relevant, keep claims grounded, and call out missing information instead of guessing.";
const RETRIEVAL_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "because",
  "but",
  "can",
  "could",
  "for",
  "from",
  "have",
  "how",
  "into",
  "like",
  "make",
  "more",
  "not",
  "old",
  "our",
  "please",
  "should",
  "that",
  "the",
  "their",
  "then",
  "there",
  "this",
  "use",
  "was",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "you",
  "your"
]);

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
    enableAutoTrim: settings.enableAutoTrim ?? true,
    enableRetrieval: Boolean(settings.enableRetrieval),
    retrievalLimit: boundedInteger(
      settings.retrievalLimit,
      DEFAULT_RETRIEVAL_LIMIT,
      1,
      MAX_RETRIEVAL_LIMIT
    ),
    expertMode: Boolean(settings.expertMode),
    expertInstructions: settings.expertInstructions?.trim() ?? ""
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
  const augmentation = augmentContextMessages(params.messages, settings);
  const inputMessages = augmentation.messages;
  const contextLimit = settings.numCtx;
  const beforeBudget = calculateContextBudget({
    messages: inputMessages,
    contextLimit,
    outputReserveTokens: settings.reserveOutputTokens,
    nearFullThresholdPercent: settings.nearFullThresholdPercent
  });

  if (
    settings.mode !== "friendly" ||
    !contextLimit ||
    !beforeBudget.wouldExceedLimit ||
    (!settings.enableAutoTrim && !settings.enableAutoSummarize)
  ) {
    return {
      messages: inputMessages,
      budget: beforeBudget,
      contextNotice: {
        mode: settings.mode,
        action: "none",
        retrievedMemoryCount: augmentation.retrievedMessages.length || undefined,
        estimatedRetrievedTokens: augmentation.estimatedRetrievedTokens || undefined,
        expertMode: augmentation.expertMode || undefined,
        estimatedPromptTokensBefore: beforeBudget.estimatedPromptTokens,
        estimatedPromptTokensAfter: beforeBudget.estimatedPromptTokens,
        outputReserveTokens: beforeBudget.estimatedOutputReserve
      }
    };
  }

  const promptBudget = Math.max(0, contextLimit - settings.reserveOutputTokens);
  const managedContext =
    settings.enableAutoSummarize
      ? summarizeMessagesToBudget(inputMessages, promptBudget) ??
        (settings.enableAutoTrim ? trimContextMessages(inputMessages, promptBudget) : null)
      : trimContextMessages(inputMessages, promptBudget);
  const preparedMessages = managedContext?.messages ?? inputMessages;
  const afterBudget = calculateContextBudget({
    messages: preparedMessages,
    contextLimit,
    outputReserveTokens: settings.reserveOutputTokens,
    nearFullThresholdPercent: settings.nearFullThresholdPercent
  });
  const omittedMessages =
    managedContext?.omittedMessages ?? omittedOutboundMessages(inputMessages, preparedMessages);
  const estimatedOmittedTokens = omittedMessages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0
  );

  return {
    messages: preparedMessages,
    budget: afterBudget,
    contextNotice: {
      mode: "friendly",
      action: omittedMessages.length > 0 ? managedContext?.action ?? "trimmed" : "none",
      omittedMessageCount: omittedMessages.length || undefined,
      estimatedOmittedTokens: estimatedOmittedTokens || undefined,
      retrievedMemoryCount: augmentation.retrievedMessages.length || undefined,
      estimatedRetrievedTokens: augmentation.estimatedRetrievedTokens || undefined,
      expertMode: augmentation.expertMode || undefined,
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

  if ((notice?.retrievedMemoryCount ?? 0) > 0) {
    warnings.push({
      kind: "retrieved",
      message: `${notice?.retrievedMemoryCount ?? "Some"} relevant older message${
        notice?.retrievedMemoryCount === 1 ? "" : "s"
      } retrieved into context.`
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

function augmentContextMessages(messages: ChatMessage[], settings: OllamaContextSettings) {
  const syntheticMessages: ChatMessage[] = [];
  const retrievedMessages = settings.mode === "friendly" && settings.enableRetrieval
    ? retrieveRelevantMessages(messages, settings.retrievalLimit)
    : [];
  const retrievalMessage = createRetrievalMessage(retrievedMessages);
  const expertMessage = createExpertMessage(settings);

  if (expertMessage) syntheticMessages.push(expertMessage);
  if (retrievalMessage) syntheticMessages.push(retrievalMessage);

  return {
    messages:
      syntheticMessages.length > 0
        ? insertSyntheticSystemMessages(messages, syntheticMessages)
        : messages,
    retrievedMessages,
    estimatedRetrievedTokens: retrievalMessage ? estimateMessageTokens(retrievalMessage) : 0,
    expertMode: Boolean(expertMessage)
  };
}

function createExpertMessage(settings: OllamaContextSettings): ChatMessage | null {
  if (!settings.expertMode) return null;

  const instructions =
    settings.expertInstructions.trim() || DEFAULT_EXPERT_INSTRUCTIONS;

  return {
    id: EXPERT_MESSAGE_ID,
    role: "system",
    content: `Expert mode instructions:\n${instructions}`,
    status: "complete"
  };
}

function retrieveRelevantMessages(messages: ChatMessage[], limit: number) {
  const outbound = outboundMessages(messages);
  const latestUserIndex = findLatestUserIndex(outbound);
  if (latestUserIndex <= 0) return [];

  const queryTerms = tokenizeForRetrieval(messageRetrievalText(outbound[latestUserIndex]));
  if (queryTerms.size === 0) return [];

  return outbound
    .slice(0, latestUserIndex)
    .map((message, index) => ({
      message,
      index,
      score: retrievalScore(queryTerms, message)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((candidate) => candidate.message);
}

function createRetrievalMessage(messages: ChatMessage[]): ChatMessage | null {
  if (messages.length === 0) return null;

  const header = "Relevant retrieved conversation memory:";
  const maxCharacters = RETRIEVAL_MAX_TOKENS * 4 - header.length - 1;
  const lines: string[] = [];
  let remaining = maxCharacters;

  for (const message of messages) {
    const excerpt = truncateText(
      summarizeMessage(message),
      Math.min(RETRIEVAL_SNIPPET_MAX_CHARACTERS, remaining)
    );
    if (!excerpt) continue;

    const line = `- ${roleLabel(message.role)}: ${excerpt}`;
    const nextLine = truncateText(line, remaining);
    if (!nextLine) break;

    lines.push(nextLine);
    remaining -= nextLine.length + 1;
    if (remaining <= 32) break;
  }

  if (lines.length === 0) return null;

  return {
    id: RETRIEVAL_MESSAGE_ID,
    role: "system",
    content: `${header}\n${lines.join("\n")}`,
    status: "complete"
  };
}

function insertSyntheticSystemMessages(
  messages: ChatMessage[],
  syntheticMessages: ChatMessage[]
) {
  const withoutSynthetic = messages.filter(
    (message) =>
      message.id !== EXPERT_MESSAGE_ID &&
      message.id !== RETRIEVAL_MESSAGE_ID &&
      message.id !== SUMMARY_MESSAGE_ID
  );
  const insertIndex = withoutSynthetic.findIndex((message) => message.role !== "system");
  if (insertIndex < 0) return [...withoutSynthetic, ...syntheticMessages];

  return [
    ...withoutSynthetic.slice(0, insertIndex),
    ...syntheticMessages,
    ...withoutSynthetic.slice(insertIndex)
  ];
}

function retrievalScore(queryTerms: Map<string, number>, message: ChatMessage) {
  if (message.role === "system") return 0;

  const messageTerms = tokenizeForRetrieval(messageRetrievalText(message));
  let score = 0;

  for (const [term, queryWeight] of queryTerms) {
    const messageWeight = messageTerms.get(term);
    if (messageWeight) score += queryWeight * messageWeight;
  }

  if (message.role === "user") score += 1;
  if ((message.attachments?.length ?? 0) > 0) score += 1;

  return score;
}

function messageRetrievalText(message: ChatMessage) {
  const content = buildMessageContentWithAttachments(message.content, message.attachments);
  return [content, message.thinking ?? "", message.toolName ?? ""].join(" ");
}

function tokenizeForRetrieval(text: string) {
  const terms = new Map<string, number>();
  for (const term of text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []) {
    if (RETRIEVAL_STOP_WORDS.has(term)) continue;
    terms.set(term, (terms.get(term) ?? 0) + 1);
  }

  return terms;
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

function trimContextMessages(messages: ChatMessage[], promptBudget: number) {
  const preparedMessages = trimMessagesToBudget(messages, promptBudget);

  return {
    messages: preparedMessages,
    action: "trimmed" as const,
    omittedMessages: omittedOutboundMessages(messages, preparedMessages)
  };
}

function summarizeMessagesToBudget(messages: ChatMessage[], promptBudget: number) {
  const outbound = outboundMessages(messages);
  const required = requiredMessages(outbound);
  const trimmed = trimMessagesToBudget(messages, promptBudget);
  const selected = new Set(outboundMessages(trimmed).filter((message) => outbound.includes(message)));
  let summaryTokenBudget = Math.min(
    SUMMARY_MAX_TOKENS,
    Math.max(SUMMARY_MIN_TOKENS, Math.floor(promptBudget * 0.25))
  );

  for (let attempt = 0; attempt < 12; attempt++) {
    const omittedMessages = outbound.filter((message) => !selected.has(message));
    if (omittedMessages.length === 0) return null;

    const summaryMessage = createSummaryMessage(omittedMessages, summaryTokenBudget);
    if (!summaryMessage) break;

    const candidateMessages = insertSummaryMessage(messages, outbound, selected, summaryMessage);
    if (estimateMessagesTokens(candidateMessages) <= promptBudget) {
      return {
        messages: candidateMessages,
        action: "summarized" as const,
        omittedMessages
      };
    }

    const removable = outbound.find(
      (message) => selected.has(message) && !required.has(message)
    );
    if (removable) {
      selected.delete(removable);
      continue;
    }

    if (summaryTokenBudget > SUMMARY_MIN_TOKENS) {
      summaryTokenBudget = Math.max(
        SUMMARY_MIN_TOKENS,
        Math.floor(summaryTokenBudget * 0.7)
      );
      continue;
    }

    break;
  }

  return null;
}

function requiredMessages(messages: ChatMessage[]) {
  const latestUserIndex = findLatestUserIndex(messages);
  const required = new Set<ChatMessage>();

  messages.forEach((message, index) => {
    if (message.role === "system" || index === latestUserIndex) {
      required.add(message);
    }
  });

  return required;
}

function createSummaryMessage(messages: ChatMessage[], maxSummaryTokens: number): ChatMessage | null {
  const content = buildSummaryContent(messages, maxSummaryTokens);
  if (!content) return null;

  return {
    id: SUMMARY_MESSAGE_ID,
    role: "system",
    content,
    status: "complete"
  };
}

function buildSummaryContent(messages: ChatMessage[], maxSummaryTokens: number) {
  const header = "Summary of earlier omitted conversation:";
  const maxCharacters = Math.max(0, maxSummaryTokens * 4 - header.length - 1);
  if (maxCharacters < 32) return null;

  const lines: string[] = [];
  let remaining = maxCharacters;
  const perMessageCharacters = Math.max(
    48,
    Math.floor(maxCharacters / Math.max(messages.length, 1))
  );

  for (const message of messages) {
    const excerpt = summarizeMessage(message);
    if (!excerpt) continue;

    const line = `- ${roleLabel(message.role)}: ${excerpt}`;
    const nextLine = truncateText(line, Math.min(remaining, perMessageCharacters));
    if (!nextLine) break;

    lines.push(nextLine);
    remaining -= nextLine.length + 1;
    if (remaining <= 12) break;
  }

  if (lines.length === 0) return null;
  return `${header}\n${lines.join("\n")}`;
}

function summarizeMessage(message: ChatMessage) {
  const parts = [message.content.trim()];
  if ((message.attachments?.length ?? 0) > 0) {
    const attachmentNames = message.attachments
      ?.slice(0, 4)
      .map((attachment) => attachment.name)
      .join(", ");
    const remaining = Math.max(0, (message.attachments?.length ?? 0) - 4);
    parts.push(
      `[attachments: ${attachmentNames}${remaining > 0 ? `, +${remaining} more` : ""}]`
    );
  }
  if (!message.content.trim() && message.thinking?.trim()) {
    parts.push(message.thinking.trim());
  }

  return truncateText(parts.filter(Boolean).join(" ").replace(/\s+/g, " "), 280);
}

function insertSummaryMessage(
  messages: ChatMessage[],
  outbound: ChatMessage[],
  selected: Set<ChatMessage>,
  summaryMessage: ChatMessage
) {
  const preparedMessages: ChatMessage[] = [];
  let inserted = false;

  for (const message of messages) {
    const keep = !outbound.includes(message) || selected.has(message);
    if (!keep) continue;

    if (!inserted && message.role !== "system") {
      preparedMessages.push(summaryMessage);
      inserted = true;
    }
    preparedMessages.push(message);
  }

  if (!inserted) preparedMessages.push(summaryMessage);
  return preparedMessages;
}

function omittedOutboundMessages(original: ChatMessage[], prepared: ChatMessage[]) {
  const preparedOutbound = new Set(outboundMessages(prepared));
  return outboundMessages(original).filter((message) => !preparedOutbound.has(message));
}

function roleLabel(role: ChatMessage["role"]) {
  if (role === "assistant") return "Assistant";
  if (role === "system") return "System";
  if (role === "tool") return "Tool";
  return "User";
}

function truncateText(text: string, maxCharacters: number) {
  if (maxCharacters <= 0) return "";
  if (text.length <= maxCharacters) return text;
  if (maxCharacters <= 3) return ".".repeat(maxCharacters);
  return `${text.slice(0, maxCharacters - 3).trimEnd()}...`;
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

function boundedInteger(
  value: number | null | undefined,
  defaultValue: number,
  min: number,
  max: number
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return defaultValue;
  return clamp(Math.round(value), min, max);
}

function uniqueWarnings(warnings: ContextWarning[]) {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    if (seen.has(warning.kind)) return false;
    seen.add(warning.kind);
    return true;
  });
}
