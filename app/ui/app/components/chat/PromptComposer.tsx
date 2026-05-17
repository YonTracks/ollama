"use client";

import {
  AlertCircle,
  File as FileIcon,
  FileText,
  Globe2,
  Image as ImageIcon,
  Lightbulb,
  Paperclip,
  Send,
  Square,
  X
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent
} from "react";
import { IconButton } from "@/components/ui/IconButton";
import { useToast } from "@/components/ui/ToastProvider";
import { imageAttachmentDataUrl } from "@/lib/ollama/attachments";
import { isImageGenerationModel } from "@/lib/ollama/models";
import { cn, createClientId, formatBytes } from "@/lib/utils";
import type { ChatAttachment } from "@/lib/ollama/types";
import type { LocalSettings } from "@/types/app";

interface PromptComposerProps {
  selectedModel: string;
  settings: LocalSettings;
  disabledReason: string | null;
  webSearchAvailable?: boolean;
  streaming: boolean;
  onSend(prompt: string, attachments?: ChatAttachment[]): void;
  onStop(): void;
  onUpdateSettings(updates: Partial<LocalSettings>): Promise<boolean | void> | boolean | void;
}

const MAX_ATTACHMENTS = 8;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 256 * 1024;

const IMAGE_SIZE_PRESETS = [
  { label: "512 x 512", width: 512, height: 512 },
  { label: "768 x 768", width: 768, height: 768 },
  { label: "1024 x 1024", width: 1024, height: 1024 },
  { label: "1024 x 768", width: 1024, height: 768 },
  { label: "768 x 1024", width: 768, height: 1024 }
];

const IMAGE_MIME_TYPES_BY_EXTENSION = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);

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
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/sql",
  "application/typescript",
  "application/xml",
  "application/x-sh",
  "application/x-yaml"
]);

export function PromptComposer({
  selectedModel,
  settings,
  disabledReason,
  webSearchAvailable = true,
  streaming,
  onSend,
  onStop,
  onUpdateSettings
}: PromptComposerProps) {
  const { showToast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const disabled = Boolean(disabledReason);
  const hasDraft = prompt.trim().length > 0 || attachments.length > 0;
  const imageGeneration = isImageGenerationModel(selectedModel);
  const selectedImageSizePreset =
    IMAGE_SIZE_PRESETS.find(
      (preset) =>
        preset.width === settings.imageGenerationWidth &&
        preset.height === settings.imageGenerationHeight
    )?.label ?? "Custom";

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [prompt]);

  const addFiles = async (fileList: FileList | File[]) => {
    if (disabled || streaming) return;

    const files = Array.from(fileList);
    if (files.length === 0) return;

    const remainingSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    if (remainingSlots === 0) {
      const message = "Remove an attachment before adding another one.";
      setAttachmentError(message);
      showToast({
        id: "attachment-error",
        title: "Attachment not added",
        description: message,
        tone: "danger",
        duration: 7000
      });
      return;
    }

    const selectedFiles = files.slice(0, remainingSlots);
    const errors =
      files.length > remainingSlots
        ? [`Only ${MAX_ATTACHMENTS} attachments can be sent at once.`]
        : [];
    const nextAttachments: ChatAttachment[] = [];

    for (const file of selectedFiles) {
      try {
        nextAttachments.push(await fileToAttachment(file));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Could not attach ${file.name}.`);
      }
    }

    if (nextAttachments.length > 0) {
      setAttachments((current) =>
        [...current, ...nextAttachments].slice(0, MAX_ATTACHMENTS)
      );
      showToast({
        id: "attachments-added",
        title: nextAttachments.length === 1 ? "Attachment added" : "Attachments added",
        description:
          nextAttachments.length === 1
            ? nextAttachments[0].name
            : `${nextAttachments.length} files are ready to send.`,
        tone: "success",
        duration: 2600
      });
    }

    const attachmentErrorMessage = errors.length > 0 ? errors.join(" ") : null;
    setAttachmentError(attachmentErrorMessage);
    if (attachmentErrorMessage) {
      showToast({
        id: "attachment-error",
        title: "Attachment not added",
        description: attachmentErrorMessage,
        tone: "danger",
        duration: 7000
      });
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void addFiles(event.target.files ?? []);
    event.target.value = "";
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (disabled || streaming || !isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (!nextTarget || !event.currentTarget.contains(nextTarget as Node)) {
      setDragActive(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (disabled || streaming) return;
    event.preventDefault();
    setDragActive(false);
    void addFiles(event.dataTransfer.files);
  };

  const submit = () => {
    if (!hasDraft || disabled || streaming) return;
    onSend(prompt, attachments);
    setPrompt("");
    setAttachments([]);
    setAttachmentError(null);
  };

  const updateImageNumberSetting = (
    key:
      | "imageGenerationWidth"
      | "imageGenerationHeight"
      | "imageGenerationSteps",
    value: number
  ) => {
    onUpdateSettings({ [key]: value } as Partial<LocalSettings>);
  };

  return (
    <footer className="flex-none border-t border-border bg-background/90 px-3 py-3 backdrop-blur sm:px-4">
      <div className="mx-auto max-w-4xl">
        <div
          className={cn(
            "relative rounded-md border bg-panel shadow-panel transition",
            disabled ? "border-border opacity-75" : "border-border focus-within:border-accent/50",
            dragActive && "border-accent/60 bg-accent/5"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.c,.cpp,.cs,.css,.csv,.go,.h,.html,.java,.js,.json,.jsx,.log,.md,.mdx,.py,.rb,.rs,.sh,.sql,.ts,.tsx,.txt,.xml,.yaml,.yml"
            onChange={handleFileInput}
            className="hidden"
          />
          {dragActive ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border border-accent/70 bg-background/80 text-sm font-medium text-accent backdrop-blur-sm">
              Drop files to attach
            </div>
          ) : null}

          {attachments.length > 0 || attachmentError ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              {attachments.map((attachment) => (
                <AttachmentChip
                  key={attachment.id}
                  attachment={attachment}
                  disabled={streaming}
                  onRemove={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id)
                    )
                  }
                />
              ))}
              {attachmentError ? (
                <div className="flex min-h-9 items-center gap-2 rounded-md border border-danger/25 bg-danger/10 px-2.5 text-xs text-danger">
                  <AlertCircle className="h-3.5 w-3.5 flex-none" />
                  <span>{attachmentError}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <label className="sr-only" htmlFor="prompt">
            Message
          </label>
          <textarea
            ref={textareaRef}
            id="prompt"
            value={prompt}
            rows={1}
            disabled={disabled || streaming}
            placeholder={
              disabledReason ? disabledReason : `Message ${selectedModel || "Ollama"}`
            }
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="block max-h-44 min-h-14 w-full resize-none bg-transparent px-4 py-4 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />

          <div className="flex items-center gap-2 border-t border-border px-2 py-2">
            {imageGeneration ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="flex h-9 items-center gap-2 rounded-md border border-accent/35 bg-accent/10 px-2.5 text-sm text-accent">
                  <ImageIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">Image</span>
                </span>

                <label className="sr-only" htmlFor="image-size-preset">
                  Image size
                </label>
                <select
                  id="image-size-preset"
                  value={selectedImageSizePreset}
                  disabled={disabled || streaming}
                  onChange={(event) => {
                    const preset = IMAGE_SIZE_PRESETS.find(
                      (option) => option.label === event.target.value
                    );
                    if (!preset) return;
                    onUpdateSettings({
                      imageGenerationWidth: preset.width,
                      imageGenerationHeight: preset.height
                    });
                  }}
                  className="h-9 rounded-md border border-border bg-panel-strong px-2 text-sm text-muted-foreground outline-none transition focus:focus-ring disabled:opacity-50"
                >
                  {IMAGE_SIZE_PRESETS.map((preset) => (
                    <option key={preset.label} value={preset.label}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="Custom">Custom</option>
                </select>

                <NumberField
                  label="Width"
                  value={settings.imageGenerationWidth}
                  min={256}
                  max={2048}
                  step={64}
                  disabled={disabled || streaming}
                  onChange={(value) => updateImageNumberSetting("imageGenerationWidth", value)}
                />
                <NumberField
                  label="Height"
                  value={settings.imageGenerationHeight}
                  min={256}
                  max={2048}
                  step={64}
                  disabled={disabled || streaming}
                  onChange={(value) => updateImageNumberSetting("imageGenerationHeight", value)}
                />
                <NumberField
                  label="Steps"
                  value={settings.imageGenerationSteps}
                  min={1}
                  max={100}
                  step={1}
                  disabled={disabled || streaming}
                  onChange={(value) => updateImageNumberSetting("imageGenerationSteps", value)}
                />
              </div>
            ) : null}

            {webSearchAvailable && !imageGeneration ? (
              <button
                type="button"
                aria-pressed={settings.webSearchEnabled}
                onClick={() =>
                  onUpdateSettings({ webSearchEnabled: !settings.webSearchEnabled })
                }
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition focus:focus-ring",
                  settings.webSearchEnabled
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                <Globe2 className="h-4 w-4" />
                <span className="hidden sm:inline">Web</span>
              </button>
            ) : null}

            {!imageGeneration ? (
              <>
                <button
                  type="button"
                  aria-pressed={settings.thinkEnabled}
                  onClick={() => onUpdateSettings({ thinkEnabled: !settings.thinkEnabled })}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition focus:focus-ring",
                    settings.thinkEnabled
                      ? "border-warning/40 bg-warning/10 text-warning"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Lightbulb className="h-4 w-4" />
                  <span className="hidden sm:inline">Think</span>
                </button>

                <select
                  aria-label="Thinking level"
                  value={settings.thinkLevel}
                  disabled={!settings.thinkEnabled}
                  onChange={(event) =>
                    onUpdateSettings({
                      thinkLevel: event.target.value as LocalSettings["thinkLevel"]
                    })
                  }
                  className="h-9 rounded-md border border-border bg-panel-strong px-2 text-sm text-muted-foreground outline-none transition focus:focus-ring disabled:opacity-50"
                >
                  <option value="none">Auto</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </>
            ) : null}

            {!imageGeneration ? <div className="min-w-0 flex-1" /> : null}

            <IconButton
              label="Attach files"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || streaming}
            >
              <Paperclip className="h-4 w-4" />
            </IconButton>

            {streaming ? (
              <IconButton label="Stop response" onClick={onStop} variant="danger">
                <Square className="h-4 w-4 fill-current" />
              </IconButton>
            ) : (
              <IconButton
                label="Send message"
                onClick={submit}
                disabled={disabled || !hasDraft}
                variant="solid"
              >
                <Send className="h-4 w-4" />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange(value: number): void;
}) {
  return (
    <label className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-panel-strong px-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (!Number.isFinite(parsed)) return;
          onChange(Math.min(max, Math.max(min, parsed)));
        }}
        className="h-7 w-16 bg-transparent text-sm text-foreground outline-none disabled:opacity-50"
      />
    </label>
  );
}

function AttachmentChip({
  attachment,
  disabled,
  onRemove
}: {
  attachment: ChatAttachment;
  disabled: boolean;
  onRemove(): void;
}) {
  const status =
    attachment.kind === "image"
      ? formatBytes(attachment.size)
      : attachment.kind === "text"
        ? `${formatBytes(attachment.size)}${attachment.truncated ? " truncated" : ""}`
        : `${formatBytes(attachment.size)} metadata only`;

  return (
    <div className="flex max-w-full items-center gap-2 rounded-md border border-border bg-panel-strong px-2 py-1.5 text-xs">
      {attachment.kind === "image" && attachment.data ? (
        <span
          className="h-9 w-9 flex-none rounded border border-border bg-cover bg-center"
          style={{ backgroundImage: `url(${imageAttachmentDataUrl(attachment)})` }}
        />
      ) : attachment.kind === "text" ? (
        <FileText className="h-4 w-4 flex-none text-accent" />
      ) : (
        <FileIcon className="h-4 w-4 flex-none text-muted-foreground" />
      )}
      <span className="min-w-0">
        <span className="block max-w-48 truncate font-medium text-foreground">
          {attachment.name}
        </span>
        <span className="block truncate text-[11px] leading-4 text-muted-foreground">
          {status}
        </span>
      </span>
      <button
        type="button"
        aria-label={`Remove ${attachment.name}`}
        title={`Remove ${attachment.name}`}
        disabled={disabled}
        onClick={onRemove}
        className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus:focus-ring disabled:opacity-45"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function isFileDrag(event: DragEvent<HTMLDivElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function isTextLikeFile(file: File) {
  const extension = getFileExtension(file.name);
  return (
    file.type.startsWith("text/") ||
    TEXT_MIME_TYPES.has(file.type) ||
    TEXT_EXTENSIONS.has(extension)
  );
}

function getFileExtension(fileName: string) {
  const extensionIndex = fileName.lastIndexOf(".");
  return extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : "";
}

function imageMimeType(file: File) {
  if (file.type.startsWith("image/")) return file.type;
  return IMAGE_MIME_TYPES_BY_EXTENSION.get(getFileExtension(file.name));
}

async function fileToAttachment(file: File): Promise<ChatAttachment> {
  const imageMime = imageMimeType(file);
  const baseAttachment = {
    id: createClientId("attachment"),
    name: file.name,
    mimeType: imageMime || file.type || "application/octet-stream",
    size: file.size
  };

  if (imageMime) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`${file.name} is larger than ${formatBytes(MAX_IMAGE_BYTES)}.`);
    }

    const dataUrl = await readAsDataUrl(file);
    const commaIndex = dataUrl.indexOf(",");
    return {
      ...baseAttachment,
      kind: "image",
      data: commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl
    };
  }

  if (isTextLikeFile(file)) {
    const truncated = file.size > MAX_TEXT_BYTES;
    const text = await readAsText(truncated ? file.slice(0, MAX_TEXT_BYTES) : file);
    return {
      ...baseAttachment,
      kind: "text",
      text,
      truncated
    };
  }

  return {
    ...baseAttachment,
    kind: "file"
  };
}

function readAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function readAsText(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsText(file);
  });
}
