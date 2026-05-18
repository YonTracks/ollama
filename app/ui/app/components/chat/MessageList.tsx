"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  Cpu,
  Download,
  ExternalLink,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Loader2,
  Search,
  User,
  X
} from "lucide-react";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { imageAttachmentDataUrl } from "@/lib/ollama/attachments";
import { isImageGenerationModel } from "@/lib/ollama/models";
import { sanitizeSearchResults } from "@/lib/search/sanitize";
import { cn, formatBytes } from "@/lib/utils";
import type {
  ChatAttachment,
  ChatMessage,
  ContextWarning,
  ResponseStats
} from "@/lib/ollama/types";

interface MessageListProps {
  messages: ChatMessage[];
  compact: boolean;
}

export function MessageList({ messages, compact }: MessageListProps) {
  const [selectedImage, setSelectedImage] = useState<ChatAttachment | null>(null);

  return (
    <>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6">
        {messages.map((message) => {
          const hasGeneratedImage =
            message.role === "assistant" &&
            Boolean(
              message.attachments?.some(
                (attachment) => attachment.kind === "image" && attachment.data
              )
            );
          const imageGenerating =
            message.role === "assistant" &&
            (message.status === "sending" || message.status === "streaming") &&
            isImageGenerationModel(message.model) &&
            !hasGeneratedImage;
          const modelLoading =
            message.role === "assistant" &&
            message.status === "sending" &&
            !imageGenerating;
          const generatedImages =
            message.role === "assistant" &&
            message.attachments?.some((attachment) => attachment.kind === "image");

          return (
            <article
              key={message.id}
              className={cn(
                "group grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3",
                compact ? "py-1" : "py-3"
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md border",
                  message.role === "user" && "border-accent/35 bg-accent/15 text-accent",
                  message.role === "assistant" &&
                    "border-border bg-panel-strong text-foreground",
                  message.role === "tool" && "border-warning/30 bg-warning/10 text-warning",
                  message.status === "error" && "border-danger/30 bg-danger/10 text-danger"
                )}
              >
                {message.role === "user" ? (
                  <User className="h-4 w-4" />
                ) : message.role === "tool" ? (
                  <Cpu className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
              </div>

              <div className="min-w-0">
                <div className="mb-1 flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium capitalize text-foreground/90">
                    {message.role === "tool" ? message.toolName || "Tool" : message.role}
                  </span>
                  {message.model ? <span>{message.model}</span> : null}
                  {message.status === "streaming" ? (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">
                      Streaming
                    </span>
                  ) : null}
                  {message.role === "assistant" && message.webSearchMode ? (
                    <WebSearchStatusPill message={message} />
                  ) : null}
                </div>

                {message.thinking ? (
                  <details className="mb-3 rounded-md border border-border bg-panel px-3 py-2 text-sm text-muted-foreground">
                    <summary
                      className={cn(
                        "cursor-pointer text-xs font-medium text-foreground",
                        message.status === "streaming" && "animate-pulse"
                      )}
                    >
                      {thinkingSummary(message)}
                    </summary>
                    <MarkdownContent
                      content={message.thinking}
                      className="mt-3 text-sm leading-6 text-muted-foreground"
                    />
                  </details>
                ) : null}

                <div
                  className={cn(
                    "wrap-break-word text-[15px] leading-7",
                    message.role === "user" &&
                      "rounded-md border border-accent/20 bg-accent/10 px-4 py-3",
                    message.role === "tool" &&
                      "rounded-md border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-muted-foreground",
                    message.status === "error" && "text-danger"
                  )}
                >
                  {imageGenerating ? <ImageGenerationPlaceholder /> : null}
                  {modelLoading ? <ModelLoadingIndicator model={message.model} /> : null}
                  {message.attachments?.length ? (
                    <MessageAttachments
                      attachments={message.attachments}
                      generated={Boolean(generatedImages)}
                      onSelectImage={setSelectedImage}
                    />
                  ) : null}
                  {message.content ? (
                    <MarkdownContent
                      content={message.content}
                      className={message.attachments?.length ? "mt-3" : undefined}
                    />
                  ) : null}
                  {message.status === "streaming" && !generatedImages && !imageGenerating ? (
                    <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-accent align-text-bottom" />
                  ) : null}
                </div>
                {message.role === "assistant" && message.webSearchResults?.length ? (
                  <WebSearchSourceLinks message={message} />
                ) : null}
                {message.role === "assistant" &&
                (message.webSearchResults?.length || message.webSearchError) ? (
                  <WebSearchResultsPanel message={message} />
                ) : null}
                {message.role === "assistant" &&
                (message.stats || message.contextWarnings?.length) ? (
                  <MessageStatsFooter
                    stats={message.stats}
                    warnings={message.contextWarnings}
                  />
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {selectedImage ? (
        <ImageLightbox image={selectedImage} onClose={() => setSelectedImage(null)} />
      ) : null}
    </>
  );
}

function WebSearchResultsPanel({ message }: { message: ChatMessage }) {
  const results = sanitizeSearchResults(message.webSearchResults ?? []);

  return (
    <details className="mt-2 rounded-md border border-border bg-panel px-3 py-2 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
        <Search className="h-3.5 w-3.5 text-accent" />
        Web search
        {message.webSearchProvider ? (
          <span className="text-muted-foreground">({message.webSearchProvider})</span>
        ) : null}
      </summary>
      {message.webSearchError ? (
        <div className="mt-2 rounded-md border border-warning/25 bg-warning/10 px-2 py-1 text-xs leading-5 text-warning">
          {message.webSearchError}
        </div>
      ) : null}
      {results.length ? (
        <ol className="mt-2 space-y-2">
          {results.map((result, index) => (
            <li key={`${result.url}-${index}`} className="min-w-0">
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-accent hover:underline"
              >
                <span className="truncate">{result.title || result.url}</span>
                <ExternalLink className="h-3 w-3 flex-none" />
              </a>
              <div className="mt-0.5 wrap-break-word text-xs leading-5 text-muted-foreground">
                {result.url}
              </div>
              {result.content ? (
                <div className="mt-1 text-xs leading-5 text-foreground/80">
                  {result.content}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </details>
  );
}

function WebSearchSourceLinks({ message }: { message: ChatMessage }) {
  const results = sanitizeSearchResults(message.webSearchResults ?? []);
  if (results.length === 0) return null;

  return (
    <div className="mt-2 flex max-w-full flex-wrap items-center gap-2 text-xs">
      <span className="flex-none text-muted-foreground">Sources</span>
      {results.map((result, index) => {
        const label = result.title || result.url;
        return (
          <a
            key={`${result.url}-source-${index}`}
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${label} - ${result.url}`}
            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border bg-panel px-2 py-1 text-accent transition hover:border-accent/45 hover:bg-accent/10 focus:focus-ring sm:max-w-64"
          >
            <span className="flex-none font-medium">[{index + 1}]</span>
            <span className="truncate">{label}</span>
            <ExternalLink className="h-3 w-3 flex-none" />
          </a>
        );
      })}
    </div>
  );
}

function WebSearchStatusPill({ message }: { message: ChatMessage }) {
  const label = webSearchStatusLabel(message);
  const failed = Boolean(message.webSearchError);
  const searched = Boolean(message.webSearchSearched);
  const skipped = !searched && message.webSearchMode !== "manual";

  return (
    <span
      title={label}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5",
        failed && "bg-warning/10 text-warning",
        !failed && searched && "bg-accent/10 text-accent",
        !failed && skipped && "bg-muted text-muted-foreground",
        !failed && !searched && !skipped && "bg-muted text-muted-foreground"
      )}
    >
      <Search className="h-3 w-3 flex-none" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function webSearchStatusLabel(message: ChatMessage) {
  if (message.webSearchError) {
    return `Web search failed: ${message.webSearchError}`;
  }

  if (message.webSearchMode === "off") {
    return "Web search off";
  }

  if (message.webSearchMode === "manual") {
    return "Web search manual";
  }

  if (message.webSearchMode === "auto") {
    const reason = message.webSearchReason || "heuristic decision";
    return message.webSearchSearched
      ? `Web search auto: searched because ${reason}`
      : `Web search auto: skipped because ${reason}`;
  }

  return "Web search";
}

function MessageStatsFooter({
  stats,
  warnings
}: {
  stats?: ResponseStats;
  warnings?: ContextWarning[];
}) {
  const parts = stats ? responseStatsParts(stats) : [];
  if (parts.length === 0 && (!warnings || warnings.length === 0)) return null;

  const label = parts.join(" \u00b7 ");

  return (
    <div className="mt-2 space-y-1">
      {parts.length > 0 ? (
        <div
          className="flex flex-wrap gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground"
          title={label}
          aria-label={`Response stats: ${label}`}
        >
          {parts.map((part, index) => (
            <span key={`${part}-${index}`} className="whitespace-nowrap">
              {part}
            </span>
          ))}
        </div>
      ) : null}
      {warnings?.length ? (
        <div className="flex flex-col gap-1 text-xs leading-5 text-warning">
          {warnings.map((warning) => (
            <div
              key={warning.kind}
              className="rounded-md border border-warning/25 bg-warning/10 px-2 py-1"
            >
              {warning.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ModelLoadingIndicator({ model }: { model?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-panel-strong px-3 py-2 text-sm text-muted-foreground"
    >
      <Loader2 className="h-4 w-4 flex-none animate-spin text-accent" />
      <span className="min-w-0 truncate">
        Loading model{model ? ` ${model}` : ""}
      </span>
    </div>
  );
}

function ImageGenerationPlaceholder() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Generating image"
      className="relative flex aspect-square w-full max-w-2xl overflow-hidden rounded-md border border-border bg-panel-strong"
    >
      <div className="absolute inset-0 animate-pulse bg-muted" />
      <div className="absolute inset-6 rounded-md border border-border/70 bg-background/25 animate-pulse" />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_0%,rgba(255,255,255,0.1)_45%,transparent_70%)]" />
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <div className="flex h-14 w-14 animate-pulse items-center justify-center rounded-md border border-accent/30 bg-accent/10">
          <ImageIcon className="h-7 w-7 text-accent" />
        </div>
        <span className="animate-pulse text-sm font-medium text-foreground">
          Generating image
        </span>
      </div>
    </div>
  );
}

function MessageAttachments({
  attachments,
  generated,
  onSelectImage
}: {
  attachments: ChatAttachment[];
  generated: boolean;
  onSelectImage(image: ChatAttachment): void;
}) {
  return (
    <div className={cn("flex gap-2", generated ? "flex-col" : "flex-wrap")}>
      {attachments.map((attachment) =>
        attachment.kind === "image" && attachment.data ? (
          <button
            key={attachment.id}
            type="button"
            title={`${attachment.name} - open fullscreen`}
            onClick={() => onSelectImage(attachment)}
            className={cn(
              "relative overflow-hidden rounded-md border border-border bg-panel-strong text-left transition hover:border-accent/45 focus:focus-ring",
              generated ? "w-full max-w-2xl" : "h-28 w-28"
            )}
          >
            {generated ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageAttachmentDataUrl(attachment)}
                alt={attachment.name}
                className="max-h-128 w-full object-contain"
              />
            ) : (
              <span
                className="block h-full w-full bg-cover bg-center"
                style={{ backgroundImage: `url(${imageAttachmentDataUrl(attachment)})` }}
              />
            )}
            <span className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-2 py-1 text-[11px] leading-4 text-foreground">
              {generated ? "Open fullscreen" : attachment.name}
            </span>
          </button>
        ) : (
          <div
            key={attachment.id}
            className="flex max-w-full items-center gap-2 rounded-md border border-border bg-panel-strong px-2.5 py-2 text-xs"
            title={attachment.name}
          >
            {attachment.kind === "text" ? (
              <FileText className="h-4 w-4 flex-none text-accent" />
            ) : (
              <FileIcon className="h-4 w-4 flex-none text-muted-foreground" />
            )}
            <span className="min-w-0">
              <span className="block max-w-56 truncate font-medium text-foreground">
                {attachment.name}
              </span>
              <span className="block text-[11px] leading-4 text-muted-foreground">
                {formatAttachmentMeta(attachment)}
              </span>
            </span>
          </div>
        )
      )}
    </div>
  );
}

function ImageLightbox({
  image,
  onClose
}: {
  image: ChatAttachment;
  onClose(): void;
}) {
  const imageUrl = imageAttachmentDataUrl(image);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/92 p-3 text-white sm:p-5">
      <button
        type="button"
        aria-label="Close image viewer"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <div className="relative z-10 flex h-12 flex-none items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{image.name}</div>
          <div className="text-xs text-white/65">{formatBytes(image.size)}</div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <a
            href={imageUrl}
            download={image.name}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 text-sm transition hover:bg-white/15 focus:focus-ring"
          >
            <Download className="h-4 w-4" />
            Download
          </a>
          <button
            type="button"
            aria-label="Close image viewer"
            title="Close"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/20 bg-white/10 transition hover:bg-white/15 focus:focus-ring"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={image.name}
          className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
        />
      </div>
    </div>
  );
}

function formatAttachmentMeta(attachment: ChatAttachment) {
  if (attachment.kind === "text" && attachment.truncated) {
    return `${formatBytes(attachment.size)} truncated`;
  }
  if (attachment.kind === "file") {
    return `${formatBytes(attachment.size)} metadata only`;
  }
  return formatBytes(attachment.size);
}

function thinkingSummary(message: ChatMessage) {
  const duration = formatThinkingDuration(
    message.thinkingTimeStart,
    message.thinkingTimeEnd
  );

  if (duration) return `Thought for ${duration}`;
  return message.status === "streaming" ? "Thinking..." : "Thinking";
}

function formatThinkingDuration(start?: string, end?: string) {
  if (!start || !end) return null;

  const durationMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function responseStatsParts(stats: ResponseStats) {
  const parts: string[] = [];

  if (typeof stats.outputTokensPerSecond === "number") {
    parts.push(`${formatRate(stats.outputTokensPerSecond)} tok/s`);
  }
  if (typeof stats.outputTokens === "number") {
    parts.push(`${formatCount(stats.outputTokens)} out`);
  }
  if (typeof stats.promptTokens === "number") {
    parts.push(`${formatCount(stats.promptTokens)} prompt`);
  }
  if (typeof stats.contextUsed === "number") {
    parts.push(formatContext(stats.contextUsed, stats.contextLimit));
  }
  if (typeof stats.totalSeconds === "number") {
    parts.push(`total ${formatDuration(stats.totalSeconds)}`);
  }
  if (typeof stats.loadSeconds === "number" && stats.loadSeconds > 0.05) {
    parts.push(`load ${formatDuration(stats.loadSeconds)}`);
  }
  if (typeof stats.promptTokensPerSecond === "number") {
    parts.push(`prompt ${formatRate(stats.promptTokensPerSecond)} tok/s`);
  }

  return parts;
}

function formatRate(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  });
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function formatContext(contextUsed: number, contextLimit: number | null | undefined) {
  if (typeof contextLimit !== "number" || contextLimit <= 0) {
    return `ctx ${formatCount(contextUsed)}`;
  }

  const percent = Math.max(0, Math.round((contextUsed / contextLimit) * 100));
  return `ctx ${formatCount(contextUsed)} / ${formatCount(contextLimit)} (${percent}%)`;
}

function formatDuration(seconds: number) {
  const fractionDigits = seconds < 10 ? 2 : 1;
  return `${seconds.toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits
  })}s`;
}
