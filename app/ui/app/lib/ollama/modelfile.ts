import type { CreateStandaloneModelRequest } from "./standalone";
import type { OllamaModelMessage } from "./types";

type ModelfileCommand =
  | { name: "from"; value: string; line: number }
  | { name: "parameter"; key: string; value: string; line: number }
  | { name: "message"; role: OllamaModelMessage["role"]; value: string; line: number }
  | {
      name: "system" | "template" | "license" | "requires" | "renderer" | "parser" | "adapter";
      value: string;
      line: number;
    };

interface ParsedModelfile {
  commands: ModelfileCommand[];
  suggestedFrom?: string;
}

export function createRequestFromModelfile(
  model: string,
  source: string
): CreateStandaloneModelRequest {
  const parsed = parseModelfile(source);
  const request: CreateStandaloneModelRequest = {
    model
  };
  const messages: OllamaModelMessage[] = [];
  let license: string | string[] | undefined;

  for (const command of parsed.commands) {
    switch (command.name) {
      case "from":
        request.from = normalizeFrom(command.value, parsed.suggestedFrom);
        break;
      case "parameter":
        request.parameters = addParameter(
          request.parameters ?? {},
          command.key,
          parseParameterValue(command.value)
        );
        break;
      case "message":
        messages.push({ role: command.role, content: command.value });
        break;
      case "system":
        request.system = command.value;
        break;
      case "template":
        request.template = command.value;
        break;
      case "license":
        license = appendLicense(license, command.value);
        break;
      case "requires":
        request.requires = command.value;
        break;
      case "renderer":
        request.renderer = command.value;
        break;
      case "parser":
        request.parser = command.value;
        break;
      case "adapter":
        throw new Error(
          `ADAPTER on line ${command.line} cannot be created from the browser. Import the adapter with the CLI first.`
        );
    }
  }

  if (!request.from) {
    throw new Error("Modelfile must include a FROM instruction.");
  }

  if (messages.length > 0) {
    request.messages = messages;
  }
  if (license) {
    request.license = license;
  }

  return request;
}

export function parseModelfile(source: string): ParsedModelfile {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const commands: ModelfileCommand[] = [];
  let suggestedFrom: string | undefined;

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const raw = lines[index];
    const trimmed = raw.trim();

    if (!trimmed) continue;

    const suggestedMatch = /^#\s*FROM\s+(.+)$/i.exec(trimmed);
    if (suggestedMatch?.[1]) {
      suggestedFrom = unquoteValue(suggestedMatch[1]);
      continue;
    }

    if (trimmed.startsWith("#")) continue;

    const first = splitWord(trimmed);
    if (!first) continue;

    const instruction = first.word.toLowerCase();
    const rest = first.rest;

    if (instruction === "parameter") {
      const parameter = splitWord(rest);
      if (!parameter || !parameter.rest.trim()) {
        throw new Error(`PARAMETER on line ${lineNumber} must include a name and value.`);
      }

      const parsedValue = readModelfileValue(lines, index, parameter.rest);
      commands.push({
        name: "parameter",
        key: parameter.word,
        value: parsedValue.value,
        line: lineNumber
      });
      index = parsedValue.index;
      continue;
    }

    if (instruction === "message") {
      const message = splitWord(rest);
      if (!message || !isMessageRole(message.word) || !message.rest.trim()) {
        throw new Error(
          `MESSAGE on line ${lineNumber} must include system, user, or assistant and message text.`
        );
      }

      const parsedValue = readModelfileValue(lines, index, message.rest);
      commands.push({
        name: "message",
        role: message.word,
        value: parsedValue.value,
        line: lineNumber
      });
      index = parsedValue.index;
      continue;
    }

    if (instruction === "from") {
      if (!rest.trim()) throw new Error(`FROM on line ${lineNumber} must include a model.`);
      commands.push({ name: "from", value: unquoteValue(rest), line: lineNumber });
      continue;
    }

    if (isValueInstruction(instruction)) {
      if (!rest.trim()) {
        throw new Error(`${instruction.toUpperCase()} on line ${lineNumber} must include a value.`);
      }

      const parsedValue = readModelfileValue(lines, index, rest);
      commands.push({ name: instruction, value: parsedValue.value, line: lineNumber });
      index = parsedValue.index;
      continue;
    }

    throw new Error(`Unsupported Modelfile instruction on line ${lineNumber}: ${first.word}`);
  }

  return { commands, suggestedFrom };
}

function normalizeFrom(value: string, suggestedFrom?: string) {
  const from = value.trim();
  if (isPathLikeFromSource(from)) {
    if (suggestedFrom && !isPathLikeFromSource(suggestedFrom)) {
      return suggestedFrom;
    }

    throw new Error(
      "Browser Modelfile create can only use an existing model name in FROM. Import local files with GGUF import or the Ollama CLI first."
    );
  }

  return from;
}

export function isPathLikeFromSource(value: string) {
  const from = value.trim();
  return (
    from.startsWith("/") ||
    from.startsWith("\\") ||
    from.startsWith("./") ||
    from.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(from) ||
    from.startsWith("~") ||
    from.startsWith("sha256:") ||
    from.startsWith("sha256-")
  );
}

function addParameter(
  parameters: NonNullable<CreateStandaloneModelRequest["parameters"]>,
  key: string,
  value: string | number | boolean
) {
  const current = parameters[key];
  if (current === undefined) {
    parameters[key] = value;
    return parameters;
  }

  if (Array.isArray(current)) {
    parameters[key] = [...current, String(value)];
  } else {
    parameters[key] = [String(current), String(value)];
  }

  return parameters;
}

function appendLicense(current: string | string[] | undefined, value: string) {
  if (!current) return value;
  return Array.isArray(current) ? [...current, value] : [current, value];
}

function parseParameterValue(value: string) {
  const parsed = unquoteValue(value);
  if (/^(true|false)$/i.test(parsed)) {
    return parsed.toLowerCase() === "true";
  }
  if (/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(parsed)) {
    return Number(parsed);
  }
  return parsed;
}

function readModelfileValue(lines: string[], index: number, rawValue: string) {
  const value = rawValue.trim();
  if (!value.startsWith('"""')) {
    return {
      value: unquoteValue(value),
      index
    };
  }

  const first = value.slice(3);
  const sameLineEnd = first.indexOf('"""');
  if (sameLineEnd >= 0) {
    return {
      value: first.slice(0, sameLineEnd),
      index
    };
  }

  const parts: string[] = [];
  if (first.length > 0) parts.push(first);

  for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex++) {
    const nextLine = lines[nextIndex];
    const end = nextLine.indexOf('"""');
    if (end >= 0) {
      const beforeEnd = nextLine.slice(0, end);
      if (beforeEnd.length > 0) parts.push(beforeEnd);
      return {
        value: parts.join("\n"),
        index: nextIndex
      };
    }
    parts.push(nextLine);
  }

  throw new Error(`Unterminated triple-quoted value starting on line ${index + 1}.`);
}

function splitWord(value: string) {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(value.trim());
  if (!match?.[1]) return null;
  return {
    word: match[1],
    rest: match[2] ?? ""
  };
}

function unquoteValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function isMessageRole(role: string): role is OllamaModelMessage["role"] {
  return role === "system" || role === "user" || role === "assistant";
}

function isValueInstruction(
  instruction: string
): instruction is "system" | "template" | "license" | "requires" | "renderer" | "parser" | "adapter" {
  return (
    instruction === "system" ||
    instruction === "template" ||
    instruction === "license" ||
    instruction === "requires" ||
    instruction === "renderer" ||
    instruction === "parser" ||
    instruction === "adapter"
  );
}
