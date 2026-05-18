"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  Bot,
  Check,
  Clipboard,
  Cpu,
  Download,
  ExternalLink,
  File as FileIcon,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  User,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { useToast } from "@/components/ui/ToastProvider";
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
  actionsDisabled?: boolean;
  onRetryMessage?(messageId: string): Promise<boolean | void> | boolean | void;
  onDeleteMessage?(messageId: string): Promise<boolean | void> | boolean | void;
  onBranchMessage?(messageId: string): Promise<string | null | void> | string | null | void;
}

export function MessageList({
  messages,
  compact,
  actionsDisabled = false,
  onRetryMessage,
  onDeleteMessage,
  onBranchMessage
}: MessageListProps) {
  const { showToast } = useToast();
  const [selectedImage, setSelectedImage] = useState<ChatAttachment | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  useEffect(() => {
    if (!openActionMenuId) return;
    if (!messages.some((message) => message.id === openActionMenuId)) {
      setOpenActionMenuId(null);
    }
  }, [messages, openActionMenuId]);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  const handleCopy = async (message: ChatMessage) => {
    const text = messageActionText(message);
    if (!text) return;

    try {
      await copyText(text);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId(null), 1400);
      showToast({
        id: "message-copy",
        title: "Message copied",
        tone: "success",
        duration: 2200
      });
    } catch (error) {
      showToast({
        id: "message-copy",
        title: "Could not copy message",
        description: error instanceof Error ? error.message : "Clipboard access failed.",
        tone: "danger",
        duration: 7000
      });
    }
  };

  const handleShare = async (message: ChatMessage) => {
    const text = messageActionText(message);
    if (!text) return;

    try {
      if (navigator.share) {
        await navigator.share({
          title: `${messageRoleLabel(message)} message`,
          text
        });
      } else {
        await copyText(text);
        showToast({
          id: "message-share",
          title: "Share text copied",
          description: "This browser does not expose a share sheet here.",
          tone: "success",
          duration: 3200
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      showToast({
        id: "message-share",
        title: "Could not share message",
        description: error instanceof Error ? error.message : "Sharing is not available.",
        tone: "danger",
        duration: 7000
      });
    }
  };

  const handleReadAloud = (message: ChatMessage) => {
    const text = readAloudText(message);
    if (!text) {
      showToast({
        id: "message-read-aloud",
        title: "Nothing to read",
        tone: "warning",
        duration: 2600
      });
      return;
    }

    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      showToast({
        id: "message-read-aloud",
        title: "Read aloud is not available",
        description: "This browser does not expose speech synthesis here.",
        tone: "warning",
        duration: 4200
      });
      return;
    }

    if (speakingMessageId === message.id && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeakingMessageId(null);
    utterance.onerror = () => setSpeakingMessageId(null);
    setSpeakingMessageId(message.id);
    window.speechSynthesis.speak(utterance);
  };

  const handleRetry = async (message: ChatMessage) => {
    try {
      showToast({
        id: "message-retry",
        title: "Trying again",
        description: "The conversation was rewound to that prompt.",
        tone: "info",
        duration: 2600
      });
      await onRetryMessage?.(message.id);
    } catch (error) {
      showToast({
        id: "message-retry",
        title: "Could not try again",
        description: error instanceof Error ? error.message : "Retry failed.",
        tone: "danger",
        duration: 7000
      });
    }
  };

  const handleDelete = async (message: ChatMessage) => {
    if (!window.confirm("Delete this message from the conversation?")) return;

    try {
      await onDeleteMessage?.(message.id);
      showToast({
        id: "message-delete",
        title: "Message deleted",
        tone: "success",
        duration: 2400
      });
    } catch (error) {
      showToast({
        id: "message-delete",
        title: "Could not delete message",
        description: error instanceof Error ? error.message : "Delete failed.",
        tone: "danger",
        duration: 7000
      });
    }
  };

  const handleBranch = async (message: ChatMessage) => {
    try {
      await onBranchMessage?.(message.id);
      showToast({
        id: "message-branch",
        title: "Branched into a new chat",
        description: "The new conversation includes messages through that turn.",
        tone: "success",
        duration: 3200
      });
    } catch (error) {
      showToast({
        id: "message-branch",
        title: "Could not branch chat",
        description: error instanceof Error ? error.message : "Branching failed.",
        tone: "danger",
        duration: 7000
      });
    }
  };

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
                  "flex h-9 w-9 items-center justify-center rounded-lg border",
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
                <div className="mb-1 flex min-h-8 items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
                  <MessageActions
                    message={message}
                    copied={copiedMessageId === message.id}
                    speaking={speakingMessageId === message.id}
                    menuOpen={openActionMenuId === message.id}
                    disabled={message.id === "model-loading"}
                    mutationsDisabled={actionsDisabled}
                    canRetry={Boolean(onRetryMessage && message.role === "assistant")}
                    canDelete={Boolean(onDeleteMessage)}
                    canBranch={Boolean(onBranchMessage)}
                    onCopy={() => void handleCopy(message)}
                    onShare={() => void handleShare(message)}
                    onRetry={() => void handleRetry(message)}
                    onReadAloud={() => handleReadAloud(message)}
                    onDelete={() => void handleDelete(message)}
                    onBranch={() => void handleBranch(message)}
                    onToggleMenu={() =>
                      setOpenActionMenuId((current) =>
                        current === message.id ? null : message.id
                      )
                    }
                    onCloseMenu={() => setOpenActionMenuId(null)}
                  />
                </div>

                {message.thinking ? (
                  <details className="mb-3 rounded-lg border border-border bg-panel px-3 py-2 text-sm text-muted-foreground">
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
                      "rounded-lg border border-accent/20 bg-accent/10 px-4 py-3",
                    message.role === "tool" &&
                      "rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-muted-foreground",
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

function MessageActions({
  message,
  copied,
  speaking,
  menuOpen,
  disabled,
  mutationsDisabled,
  canRetry,
  canDelete,
  canBranch,
  onCopy,
  onShare,
  onRetry,
  onReadAloud,
  onDelete,
  onBranch,
  onToggleMenu,
  onCloseMenu
}: {
  message: ChatMessage;
  copied: boolean;
  speaking: boolean;
  menuOpen: boolean;
  disabled: boolean;
  mutationsDisabled: boolean;
  canRetry: boolean;
  canDelete: boolean;
  canBranch: boolean;
  onCopy(): void;
  onShare(): void;
  onRetry(): void;
  onReadAloud(): void;
  onDelete(): void;
  onBranch(): void;
  onToggleMenu(): void;
  onCloseMenu(): void;
}) {
  const pending = message.status === "sending" || message.status === "streaming";
  const structuralDisabled = disabled || mutationsDisabled || pending;
  const textAvailable = messageActionText(message).length > 0;
  const readable = readAloudText(message).length > 0;

  const runMenuAction = (action: () => void) => {
    onCloseMenu();
    action();
  };

  return (
    <div className="relative flex flex-none items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
      <ActionIconButton
        label={copied ? "Copied" : "Copy message"}
        disabled={disabled || !textAvailable}
        onClick={onCopy}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
      </ActionIconButton>

      <ActionIconButton
        label="Share message"
        disabled={disabled || !textAvailable}
        onClick={onShare}
      >
        <Share2 className="h-3.5 w-3.5" />
      </ActionIconButton>

      {canRetry ? (
        <ActionIconButton
          label="Try again"
          disabled={structuralDisabled}
          onClick={onRetry}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </ActionIconButton>
      ) : null}

      <ActionIconButton
        label="More actions"
        disabled={disabled || (!textAvailable && !canDelete && !canBranch)}
        onClick={onToggleMenu}
        aria-expanded={menuOpen}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </ActionIconButton>

      {menuOpen ? (
        <div
          className="absolute right-0 top-9 z-30 w-52 overflow-hidden rounded-lg border border-border bg-panel-strong p-1 text-sm shadow-panel"
          onKeyDown={(event) => {
            if (event.key === "Escape") onCloseMenu();
          }}
        >
          <MenuAction
            label={speaking ? "Stop reading" : "Read aloud"}
            disabled={!readable}
            tone={speaking ? "warning" : "normal"}
            onClick={() => runMenuAction(onReadAloud)}
            icon={speaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          />
          {canBranch ? (
            <MenuAction
              label="Branch in new chat"
              disabled={structuralDisabled}
              onClick={() => runMenuAction(onBranch)}
              icon={<GitBranch className="h-4 w-4" />}
            />
          ) : null}
          {canDelete ? (
            <MenuAction
              label="Delete message"
              disabled={structuralDisabled}
              tone="danger"
              onClick={() => runMenuAction(onDelete)}
              icon={<Trash2 className="h-4 w-4" />}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActionIconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground transition hover:border-border hover:bg-muted hover:text-foreground focus:focus-ring disabled:cursor-not-allowed disabled:opacity-35"
      {...props}
    >
      {children}
    </button>
  );
}

function MenuAction({
  label,
  icon,
  tone = "normal",
  disabled,
  onClick
}: {
  label: string;
  icon: ReactNode;
  tone?: "normal" | "warning" | "danger";
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left transition focus:focus-ring disabled:cursor-not-allowed disabled:opacity-40",
        tone === "normal" && "text-foreground hover:bg-muted",
        tone === "warning" && "text-warning hover:bg-warning/10",
        tone === "danger" && "text-danger hover:bg-danger/10"
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function messageActionText(message: ChatMessage) {
  const sections: string[] = [];
  const content = message.content.trim();
  if (content) sections.push(content);

  if (message.attachments?.length) {
    sections.push(
      message.attachments
        .map((attachment) => `Attachment: ${attachment.name}`)
        .join("\n")
    );
  }

  const sources = sanitizeSearchResults(message.webSearchResults ?? []);
  if (sources.length) {
    sections.push(
      [
        "Sources:",
        ...sources.map(
          (source, index) =>
            `[${index + 1}] ${source.title || source.url}\n${source.url}`
        )
      ].join("\n")
    );
  }

  return sections.join("\n\n").trim();
}

function readAloudText(message: ChatMessage) {
  return stripMarkdownForSpeech(message.content).trim();
}

function messageRoleLabel(message: ChatMessage) {
  if (message.role === "tool") return message.toolName || "Tool";
  return message.role.charAt(0).toUpperCase() + message.role.slice(1);
}

function stripMarkdownForSpeech(input: string) {
  return input
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~#>]+/g, "")
    .replace(/\s+/g, " ");
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function WebSearchResultsPanel({ message }: { message: ChatMessage }) {
  const results = sanitizeSearchResults(message.webSearchResults ?? []);

  return (
    <details className="mt-2 rounded-lg border border-border bg-panel px-3 py-2 text-sm">
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
      className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-panel-strong px-3 py-2 text-sm text-muted-foreground"
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
      className="relative flex aspect-square w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-panel-strong"
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
              "relative overflow-hidden rounded-lg border border-border bg-panel-strong text-left transition hover:border-accent/45 focus:focus-ring",
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
            className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-panel-strong px-2.5 py-2 text-xs"
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
