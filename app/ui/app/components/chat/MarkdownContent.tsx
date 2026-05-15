"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

interface TextPart {
  type: "text";
  content: string;
}

interface CodePart {
  type: "code";
  content: string;
  language: string;
}

interface InlineTextPart {
  type: "text";
  content: string;
}

interface InlineCodePart {
  type: "code";
  content: string;
}

interface InlineStrongPart {
  type: "strong";
  content: string;
}

interface InlineEmphasisPart {
  type: "emphasis";
  content: string;
}

export type MarkdownPart = TextPart | CodePart;
export type InlineMarkdownPart =
  | InlineTextPart
  | InlineCodePart
  | InlineStrongPart
  | InlineEmphasisPart;

const KEYWORDS = new Set([
  "and",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "def",
  "defer",
  "default",
  "else",
  "export",
  "false",
  "final",
  "for",
  "from",
  "func",
  "function",
  "go",
  "if",
  "import",
  "in",
  "interface",
  "lambda",
  "let",
  "map",
  "new",
  "nil",
  "not",
  "null",
  "or",
  "package",
  "private",
  "protected",
  "public",
  "range",
  "return",
  "select",
  "static",
  "struct",
  "switch",
  "throw",
  "true",
  "try",
  "type",
  "undefined",
  "var",
  "while",
  "yield"
]);

const TOKEN_PATTERN =
  /(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/.*|\/\*.*?\*\/|#.*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$-]*\b|[{}()[\].,;:+\-*/%=<>!&|?]+)/g;
const BOLD_PREFIX_PATTERN = /^\s*\*\*[^*\n]{1,160}\*\*(?:\s|$)/;
const HEADING_PATTERN = /^#{1,6}\s+/;
const EMOJI_HEADING_PATTERN =
  /^\s*(?:[\u203C-\u3299]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF])/;
const LIST_ITEM_PATTERN = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/;
const TABLE_ROW_PATTERN = /^\s*\|.+\|\s*$/;
const BLOCKQUOTE_PATTERN = /^\s{0,3}>/;

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const parts = parseMarkdownContent(content);

  return (
    <div className={cn("space-y-3", className)}>
      {parts.map((part, index) =>
        part.type === "code" ? (
          <CodeBlock
            key={`${part.type}-${index}`}
            code={part.content}
            language={part.language}
          />
        ) : (
          <TextContent key={`${part.type}-${index}`} content={part.content} />
        )
      )}
    </div>
  );
}

export function parseMarkdownContent(content: string): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  const fencePattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(content)) !== null) {
    if (match.index > cursor) {
      parts.push({ type: "text", content: content.slice(cursor, match.index) });
    }

    parts.push({
      type: "code",
      language: normalizeLanguage(match[1]),
      content: trimCodeBlock(match[2])
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) {
    parts.push({ type: "text", content: content.slice(cursor) });
  }

  return parts.length > 0 ? parts : [{ type: "text", content }];
}

function TextContent({ content }: { content: string }) {
  const blocks = splitMarkdownTextBlocks(content);

  if (blocks.length === 0) return null;

  return (
    <>
      {blocks.map((block, index) => (
        <TextBlock key={`${block.slice(0, 16)}-${index}`} block={block} />
      ))}
    </>
  );
}

function TextBlock({ block }: { block: string }) {
  const lines = block.split("\n");
  const heading = block.match(/^\s{0,3}(#{1,6})\s+(.+)$/);

  if (isEmojiHeadingLine(block)) {
    return (
      <h3 className="mt-4 text-base font-semibold leading-6 text-foreground first:mt-0">
        {renderInline(block)}
      </h3>
    );
  }

  if (heading) {
    const Tag = heading[1].length === 1 ? "h2" : heading[1].length === 2 ? "h3" : "h4";
    return (
      <Tag className="mt-4 text-base font-semibold leading-6 text-foreground first:mt-0">
        {renderInline(heading[2])}
      </Tag>
    );
  }

  if (isTableBlock(lines)) {
    return <MarkdownTable lines={lines} />;
  }

  if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {lines.map((line, index) => (
          <li key={`${line}-${index}`}>{renderInline(line.replace(/^\s*[-*]\s+/, ""))}</li>
        ))}
      </ul>
    );
  }

  if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
    return (
      <ol className="list-decimal space-y-1 pl-5">
        {lines.map((line, index) => (
          <li key={`${line}-${index}`}>{renderInline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>
        ))}
      </ol>
    );
  }

  return (
    <p className="whitespace-pre-wrap break-words">
      {lines.map((line, index) => (
        <span key={`${line}-${index}`}>
          {index > 0 ? <br /> : null}
          {renderInline(line)}
        </span>
      ))}
    </p>
  );
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const rows = lines.map(splitTableRow).filter((row) => row.length > 1);
  const hasHeader = rows.length > 1 && isTableDividerRow(rows[1]);
  const header = hasHeader ? rows[0] : null;
  const body = hasHeader ? rows.slice(2) : rows;

  return (
    <div className="scrollbar-subtle overflow-x-auto rounded-md border border-border">
      <table className="min-w-full border-collapse text-left text-sm">
        {header ? (
          <thead className="bg-panel-strong text-foreground">
            <tr>
              {header.map((cell, index) => (
                <th
                  key={`${cell}-${index}`}
                  scope="col"
                  className="border-b border-border px-3 py-2 font-semibold"
                >
                  {renderInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join("|")}`} className="border-t border-border first:border-t-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={`${cell}-${cellIndex}`}
                  className="align-top px-3 py-2 text-muted-foreground"
                >
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await copyText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="my-4 overflow-hidden rounded-md border border-border bg-[#10120f] text-sm shadow-sm">
      <div className="flex h-10 items-center justify-between gap-3 border-b border-border bg-panel-strong px-3">
        <span className="truncate text-xs text-muted-foreground">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground focus:focus-ring"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="scrollbar-subtle overflow-x-auto p-4 font-mono text-[13px] leading-6 text-[#dfe6d8]">
        <code>
          {code.split("\n").map((line, lineIndex) => (
            <span key={`${lineIndex}-${line}`} className="block min-h-6">
              {highlightLine(line)}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function renderInline(text: string) {
  return parseInlineMarkdown(text).map((segment, index) => {
    if (segment.type === "code") {
      return (
        <code
          key={`${segment.content}-${index}`}
          className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.92em]"
        >
          {segment.content}
        </code>
      );
    }

    if (segment.type === "strong") {
      return (
        <strong key={`${segment.content}-${index}`} className="font-semibold text-foreground">
          {segment.content}
        </strong>
      );
    }

    if (segment.type === "emphasis") {
      return (
        <em key={`${segment.content}-${index}`} className="italic text-foreground/95">
          {segment.content}
        </em>
      );
    }

    return <span key={`${segment.content}-${index}`}>{segment.content}</span>;
  });
}

export function splitMarkdownTextBlocks(content: string) {
  const blocks: string[] = [];
  let currentLines: string[] = [];
  let previousWasLooseHeading = false;

  const flush = () => {
    const block = currentLines.join("\n").trim();
    if (block) {
      blocks.push(block);
    }
    currentLines = [];
  };

  for (const line of content.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      flush();
      previousWasLooseHeading = false;
      continue;
    }

    const previousLine = currentLines[currentLines.length - 1] ?? "";
    const shouldStartNewBlock =
      currentLines.length > 0 && startsNewMarkdownBlock(previousLine, line, previousWasLooseHeading);

    if (shouldStartNewBlock) {
      flush();
    }

    currentLines.push(line);
    previousWasLooseHeading = isEmojiHeadingLine(line) || HEADING_PATTERN.test(line.trim());
  }

  flush();
  return blocks;
}

export function parseInlineMarkdown(text: string): InlineMarkdownPart[] {
  const parts: InlineMarkdownPart[] = [];
  let cursor = 0;

  const pushText = (end: number) => {
    if (end > cursor) {
      parts.push({ type: "text", content: unescapeMarkdownText(text.slice(cursor, end)) });
    }
  };

  while (cursor < text.length) {
    const marker = findNextInlineMarker(text, cursor);
    if (!marker) {
      pushText(text.length);
      cursor = text.length;
      break;
    }

    pushText(marker.index);

    if (marker.type === "code") {
      parts.push({ type: "code", content: marker.content });
    } else if (marker.type === "strong") {
      parts.push({ type: "strong", content: unescapeMarkdownText(marker.content) });
    } else {
      parts.push({ type: "emphasis", content: unescapeMarkdownText(marker.content) });
    }

    cursor = marker.end;
  }

  return parts.length > 0 ? parts : [{ type: "text", content: text }];
}

function findNextInlineMarker(text: string, from: number) {
  for (let index = from; index < text.length; index++) {
    const char = text[index];

    if (char === "`" && !isEscaped(text, index)) {
      const end = findUnescaped(text, "`", index + 1);
      if (end > index + 1 && !text.slice(index + 1, end).includes("\n")) {
        return {
          type: "code" as const,
          index,
          end: end + 1,
          content: text.slice(index + 1, end)
        };
      }
      continue;
    }

    if (text.startsWith("**", index) && !isEscaped(text, index)) {
      const end = findUnescaped(text, "**", index + 2);
      if (end > index + 2 && !text.slice(index + 2, end).includes("\n")) {
        return {
          type: "strong" as const,
          index,
          end: end + 2,
          content: text.slice(index + 2, end)
        };
      }
      continue;
    }

    if (char === "*" && !isEscaped(text, index) && text[index - 1] !== "*" && text[index + 1] !== "*") {
      const end = findUnescaped(text, "*", index + 1);
      const content = end > index ? text.slice(index + 1, end) : "";
      if (
        end > index + 1 &&
        !content.includes("\n") &&
        content.trim().length > 0 &&
        !/^\s|\s$/.test(content)
      ) {
        return {
          type: "emphasis" as const,
          index,
          end: end + 1,
          content
        };
      }
    }
  }

  return null;
}

function unescapeMarkdownText(text: string) {
  return text.replace(/\\([`*{}\[\]()#+\-.!_|>])/g, "$1");
}

function findUnescaped(text: string, marker: string, from: number) {
  let index = text.indexOf(marker, from);

  while (index !== -1) {
    if (!isEscaped(text, index)) return index;
    index = text.indexOf(marker, index + marker.length);
  }

  return -1;
}

function isEscaped(text: string, index: number) {
  let slashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) {
    slashCount++;
  }

  return slashCount % 2 === 1;
}

function isTableBlock(lines: string[]) {
  return lines.length >= 2 && lines.every(isTableRowLine);
}

function isTableRowLine(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 1;
}

function splitTableRow(line: string) {
  const cells: string[] = [];
  let current = "";
  const text = line.trim();

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (char === "|" && !isEscaped(text, index)) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);

  if (cells[0]?.trim() === "") cells.shift();
  if (cells[cells.length - 1]?.trim() === "") cells.pop();

  return cells.map((cell) => unescapeMarkdownText(cell.trim()));
}

function isTableDividerRow(cells: string[]) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function isEmojiHeadingLine(line: string) {
  return EMOJI_HEADING_PATTERN.test(line.trim());
}

function isLooseSectionLine(line: string) {
  return BOLD_PREFIX_PATTERN.test(line) || HEADING_PATTERN.test(line.trim()) || isEmojiHeadingLine(line);
}

function startsNewMarkdownBlock(
  previousLine: string,
  currentLine: string,
  previousWasLooseHeading: boolean
) {
  if (previousWasLooseHeading) return true;
  if (isLooseSectionLine(currentLine)) return true;

  if (LIST_ITEM_PATTERN.test(previousLine) || LIST_ITEM_PATTERN.test(currentLine)) {
    return !LIST_ITEM_PATTERN.test(previousLine) || !LIST_ITEM_PATTERN.test(currentLine);
  }

  if (TABLE_ROW_PATTERN.test(previousLine) || TABLE_ROW_PATTERN.test(currentLine)) {
    return !TABLE_ROW_PATTERN.test(previousLine) || !TABLE_ROW_PATTERN.test(currentLine);
  }

  if (BLOCKQUOTE_PATTERN.test(previousLine) || BLOCKQUOTE_PATTERN.test(currentLine)) {
    return !BLOCKQUOTE_PATTERN.test(previousLine) || !BLOCKQUOTE_PATTERN.test(currentLine);
  }

  return false;
}

function highlightLine(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  TOKEN_PATTERN.lastIndex = 0;

  while ((match = TOKEN_PATTERN.exec(line)) !== null) {
    if (match.index > cursor) {
      nodes.push(line.slice(cursor, match.index));
    }

    const token = match[0];
    nodes.push(
      <span key={`${match.index}-${token}`} className={tokenClassName(token)}>
        {token}
      </span>
    );
    cursor = match.index + token.length;
  }

  if (cursor < line.length) {
    nodes.push(line.slice(cursor));
  }

  return nodes.length > 0 ? nodes : [line];
}

function tokenClassName(token: string) {
  if (token.startsWith("//") || token.startsWith("/*") || token.startsWith("#")) {
    return "text-[#7d8875]";
  }
  if (token.startsWith("\"") || token.startsWith("'") || token.startsWith("`")) {
    return "text-[#d7c56f]";
  }
  if (/^\d/.test(token)) {
    return "text-[#86d4ff]";
  }
  if (KEYWORDS.has(token)) {
    return "text-[#b6f09c]";
  }
  if (/^[{}()[\].,;:+\-*/%=<>!&|?]+$/.test(token)) {
    return "text-[#aab3a3]";
  }
  return "text-[#dfded6]";
}

function normalizeLanguage(info: string) {
  return info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function trimCodeBlock(code: string) {
  return code.replace(/^\n/, "").replace(/\n$/, "");
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
}
