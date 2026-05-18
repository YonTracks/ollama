const EXPLICIT_WEB_LOOKUP_PATTERNS = [
  /\b(search|browse)\s+(the\s+)?(web|internet)\b/i,
  /\b(web|internet|online)\s+(search|lookup|look\s*up)\b/i,
  /\blook\s*up\b/i,
  /\blookup\b/i,
  /\baccording to (the )?(docs|documentation|official docs)\b/i
];

const LOCAL_ONLY_PATTERNS = [
  /\b(in this repo|this codebase|local file|workspace|working directory)\b/i,
  /\b(edit|modify|refactor|implement|fix|commit|diff|run tests?|write tests?)\b/i,
  /\b(readme|docs?)\b.*\b(update|edit|fix|write|rewrite)\b/i,
  /\b(update|edit|fix|write|rewrite)\b.*\b(readme|docs?)\b/i,
  /\b(app|src|lib|components?|hooks?)\/[^\s]+/i,
  /\b[\w.-]+\.(ts|tsx|js|jsx|go|py|rs|md|mdx|json|yaml|yml|css|html)\b/i
];

const CREATIVE_OR_PRIVATE_PATTERNS = [
  /\b(write|draft|compose)\s+(a\s+)?(story|poem|song|scene|joke)\b/i,
  /\bcreative writing\b/i,
  /\bbrainstorm\b.*\b(private|project|plan|roadmap)\b/i,
  /\b(private project planning|personal planning)\b/i
];

const PROVIDED_TEXT_PATTERNS = [
  /\b(summarize|rewrite|edit|proofread|format)\s+(this|the following|provided)\b/i,
  /\buse only (the )?(text|context|content) (above|below|provided)\b/i
];

const OFFLINE_PATTERNS = [
  /\boffline\b/i,
  /\blocal-only\b/i,
  /\bwithout (the )?(web|internet|online search)\b/i
];

const FRESHNESS_PATTERNS = [
  /\b(latest|current|today|yesterday|this week|this month|news|recent|new release|release notes?|changelog|price|pricing)\b/i,
  /\bwhat happened\b/i,
  /\bis .+ still\b/i,
  /\bwho is\b/i
];

const DOCS_AND_PROVIDER_PATTERNS = [
  /\b(api|apis|provider|providers|official docs|documentation|docs)\b/i,
  /\b(best|recommended)\s+(web\s+search\s+)?api\b/i,
  /\b(package|library|framework|sdk)\b.*\b(version|release|changelog|docs?|documentation)\b/i,
  /\b(version|release|changelog|docs?|documentation)\b.*\b(package|library|framework|sdk)\b/i
];

const TROUBLESHOOTING_PATTERNS = [
  /\b(error message|stack trace|exception|github issue|issue #\d+)\b/i,
  /\b(error|bug|crash)\b.*\b(lookup|look\s*up|search|github|issue|known|docs?)\b/i,
  /\b(lookup|look\s*up|search)\b.*\b(error|bug|crash|exception)\b/i
];

const COMPARISON_PATTERNS = [
  /\bcompare\b/i,
  /\bbest web search api\b/i
];

export function shouldSearchPrompt(input: string): {
  shouldSearch: boolean;
  reason: string;
} {
  const prompt = input.trim();
  if (!prompt) {
    return {
      shouldSearch: false,
      reason: "empty prompt"
    };
  }

  if (matchesAny(prompt, EXPLICIT_WEB_LOOKUP_PATTERNS)) {
    return {
      shouldSearch: true,
      reason: "explicit web lookup requested"
    };
  }

  if (matchesAny(prompt, OFFLINE_PATTERNS)) {
    return {
      shouldSearch: false,
      reason: "offline or local-only request"
    };
  }

  if (matchesAny(prompt, PROVIDED_TEXT_PATTERNS)) {
    return {
      shouldSearch: false,
      reason: "provided-text task"
    };
  }

  if (matchesAny(prompt, CREATIVE_OR_PRIVATE_PATTERNS)) {
    return {
      shouldSearch: false,
      reason: "creative or private-planning task"
    };
  }

  if (
    matchesAny(prompt, LOCAL_ONLY_PATTERNS) &&
    !matchesAny(prompt, [
      ...TROUBLESHOOTING_PATTERNS,
      /\bofficial docs\b/i,
      /\baccording to (the )?(docs|documentation)\b/i
    ])
  ) {
    return {
      shouldSearch: false,
      reason: "local code or project task"
    };
  }

  if (matchesAny(prompt, FRESHNESS_PATTERNS)) {
    return {
      shouldSearch: true,
      reason: "freshness or current-info signal"
    };
  }

  if (matchesAny(prompt, TROUBLESHOOTING_PATTERNS)) {
    return {
      shouldSearch: true,
      reason: "external troubleshooting signal"
    };
  }

  if (matchesAny(prompt, DOCS_AND_PROVIDER_PATTERNS)) {
    return {
      shouldSearch: true,
      reason: "docs, API, or provider signal"
    };
  }

  if (matchesAny(prompt, COMPARISON_PATTERNS)) {
    return {
      shouldSearch: true,
      reason: "comparison signal"
    };
  }

  return {
    shouldSearch: false,
    reason: "no clear freshness, docs, current-info, or lookup signal"
  };
}

function matchesAny(input: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(input));
}
