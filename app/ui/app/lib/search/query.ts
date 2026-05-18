type SearchHistoryMessage = {
  role: string;
  content: string;
};

export function webSearchQueryForPrompt(
  prompt: string,
  history: SearchHistoryMessage[] = []
) {
  const trimmed = prompt.trim();
  const previousUserMessage = [...history]
    .reverse()
    .find((message) => message.role === "user" && message.content.trim());
  if (!previousUserMessage) return trimmed;

  const previous = previousUserMessage.content.trim().replace(/\s+/g, " ");
  if (!previous) return trimmed;

  if (isGenericSearchFollowUp(trimmed)) {
    return `${previous} ${trimmed}`;
  }

  return trimmed;
}

function isGenericSearchFollowUp(prompt: string) {
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;

  return (
    /^search( for)? (it|that|this)$/.test(normalized) ||
    /^search( for)? (the )?(latest|current)? ?version$/.test(normalized) ||
    /^look ?up (it|that|this|the latest version|latest version)$/.test(normalized) ||
    /^what about (now|today|that|this)$/.test(normalized)
  );
}
