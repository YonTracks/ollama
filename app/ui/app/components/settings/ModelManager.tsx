"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Download,
  FileArchive,
  Plus,
  RefreshCcw,
  Trash2,
  Wand2
} from "lucide-react";
import {
  createStandaloneModel,
  deleteStandaloneModel,
  pullStandaloneModel,
  standaloneBlobExists,
  uploadStandaloneBlob
} from "@/lib/ollama/standalone";
import { useToast } from "@/components/ui/ToastProvider";
import { cn, formatBytes } from "@/lib/utils";
import type { ModelOperationEvent, OllamaModel } from "@/lib/ollama/types";

interface ToastOptions {
  silent?: boolean;
}

interface ModelManagerProps {
  models: OllamaModel[];
  selectedModel: string;
  apiBase?: string;
  onSelectModel(model: string, options?: ToastOptions): Promise<boolean | void> | boolean | void;
  onRefreshModels(options?: ToastOptions): Promise<boolean | void> | boolean | void;
}

type OperationKind = "pull" | "create" | "import" | "delete";

const DEFAULT_CREATE_PARAMETERS = {
  systemPrompt: "You are Mario from Super Mario Bros, acting as an assistant.",
  temperature: "0.7",
  contextLength: "4096",
  topP: "0.9",
  repeatPenalty: "1.1"
};

export function ModelManager({
  models,
  selectedModel,
  apiBase,
  onSelectModel,
  onRefreshModels
}: ModelManagerProps) {
  const { showToast } = useToast();
  const localModels = useMemo(() => models.filter((model) => model.local), [models]);
  const firstLocalModel = localModels[0]?.name ?? selectedModel;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [pullName, setPullName] = useState("");
  const [createName, setCreateName] = useState("");
  const [createBase, setCreateBase] = useState(firstLocalModel);
  const [createSystem, setCreateSystem] = useState(DEFAULT_CREATE_PARAMETERS.systemPrompt);
  const [temperature, setTemperature] = useState(DEFAULT_CREATE_PARAMETERS.temperature);
  const [contextLength, setContextLength] = useState(DEFAULT_CREATE_PARAMETERS.contextLength);
  const [topP, setTopP] = useState(DEFAULT_CREATE_PARAMETERS.topP);
  const [repeatPenalty, setRepeatPenalty] = useState(
    DEFAULT_CREATE_PARAMETERS.repeatPenalty
  );
  const [importName, setImportName] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [deleteName, setDeleteName] = useState(firstLocalModel);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [operation, setOperation] = useState<OperationKind | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const busy = operation !== null;
  const canPull = pullName.trim().length > 0 && !busy;
  const canCreate = createName.trim().length > 0 && createBase.trim().length > 0 && !busy;
  const canImport = importName.trim().length > 0 && importFile && !busy;
  const canDelete = deleteName.trim().length > 0 && confirmDelete && !busy;

  useEffect(() => {
    const hasCreateBase = localModels.some((model) => model.name === createBase);
    const hasDeleteName = localModels.some((model) => model.name === deleteName);

    if (firstLocalModel && !hasCreateBase) setCreateBase(firstLocalModel);
    if (!firstLocalModel && createBase) setCreateBase("");
    if (firstLocalModel && !hasDeleteName) setDeleteName(firstLocalModel);
    if (!firstLocalModel && deleteName) setDeleteName("");
  }, [createBase, deleteName, firstLocalModel, localModels]);

  const clearNotices = () => {
    setError(null);
    setSuccess(null);
    setProgress(null);
  };

  const applyEvent = (event: ModelOperationEvent) => {
    if (event.error) {
      setError(event.error);
      return;
    }

    setStatus(event.status);
    if (typeof event.completed === "number" && typeof event.total === "number") {
      setProgress({ completed: event.completed, total: event.total });
    }
  };

  const runStreamOperation = async (
    kind: OperationKind,
    stream: AsyncGenerator<ModelOperationEvent>,
    completeMessage: string,
    modelToSelect?: string
  ) => {
    setOperation(kind);
    clearNotices();
    setStatus("Starting");
    showToast({
      id: "model-operation",
      title: modelOperationStartTitle(kind),
      description: modelToSelect ?? "Progress is shown in the Models panel.",
      tone: "info",
      duration: 5000
    });

    try {
      for await (const event of stream) {
        if (event.error) throw new Error(event.error);
        applyEvent(event);
      }

      setSuccess(completeMessage);
      showToast({
        id: "model-operation",
        title: modelOperationSuccessTitle(kind),
        description: completeMessage,
        tone: "success"
      });
      if (modelToSelect) await Promise.resolve(onSelectModel(modelToSelect, { silent: true }));
      await Promise.resolve(onRefreshModels({ silent: true }));
    } catch (operationError) {
      const message =
        operationError instanceof Error
          ? operationError.message
          : "Model operation failed.";
      setError(message);
      showToast({
        id: "model-operation",
        title: modelOperationErrorTitle(kind),
        description: message,
        tone: "danger",
        duration: 7000
      });
    } finally {
      setOperation(null);
    }
  };

  const handlePull = () => {
    const model = pullName.trim();
    if (!model) return;

    void runStreamOperation(
      "pull",
      pullStandaloneModel(model, apiBase),
      `${model} added`,
      model
    );
  };

  const handleCreate = () => {
    const model = createName.trim();
    const from = createBase.trim();
    if (!model || !from) return;

    void runStreamOperation(
      "create",
      createStandaloneModel({
        model,
        from,
        system: createSystem.trim() || undefined,
        parameters: modelParameters({
          temperature,
          contextLength,
          topP,
          repeatPenalty
        })
      }, apiBase),
      `${model} created`,
      model
    );
  };

  const handleImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setImportFile(file);
    if (file && !importName.trim()) {
      setImportName(file.name.replace(/\.gguf$/i, "").toLowerCase().replace(/\s+/g, "-"));
    }
    if (file) {
      showToast({
        id: "model-import-file",
        title: "GGUF selected",
        description: `${file.name} (${formatBytes(file.size)})`,
        tone: "info"
      });
    }
    event.target.value = "";
  };

  const handleImport = async () => {
    const model = importName.trim();
    if (!model || !importFile) return;

    setOperation("import");
    clearNotices();
    showToast({
      id: "model-operation",
      title: "Importing model",
      description: model,
      tone: "info",
      duration: 5000
    });

    try {
      setStatus("Hashing GGUF");
      const digest = await sha256Digest(importFile);

      setStatus("Checking blob cache");
      if (!(await standaloneBlobExists(digest, apiBase))) {
        setStatus("Uploading GGUF");
        await uploadStandaloneBlob(digest, importFile, apiBase);
      }

      setStatus("Creating model");
      for await (const event of createStandaloneModel({
        model,
        files: {
          [importFile.name]: digest
        }
      }, apiBase)) {
        if (event.error) throw new Error(event.error);
        applyEvent(event);
      }

      setSuccess(`${model} imported`);
      showToast({
        id: "model-operation",
        title: "Model imported",
        description: `${model} is ready to use.`,
        tone: "success"
      });
      setImportFile(null);
      await Promise.resolve(onSelectModel(model, { silent: true }));
      await Promise.resolve(onRefreshModels({ silent: true }));
    } catch (operationError) {
      const message =
        operationError instanceof Error
          ? operationError.message
          : "Model import failed.";
      setError(message);
      showToast({
        id: "model-operation",
        title: "Model import failed",
        description: message,
        tone: "danger",
        duration: 7000
      });
    } finally {
      setOperation(null);
    }
  };

  const handleDelete = async () => {
    const model = deleteName.trim();
    if (!model || !confirmDelete) return;

    setOperation("delete");
    clearNotices();
    setStatus("Deleting model");
    showToast({
      id: "model-operation",
      title: "Deleting model",
      description: model,
      tone: "warning",
      duration: 5000
    });

    try {
      await deleteStandaloneModel(model, apiBase);
      setSuccess(`${model} deleted`);
      showToast({
        id: "model-operation",
        title: "Model deleted",
        description: model,
        tone: "success"
      });
      setConfirmDelete(false);
      setDeleteName("");
      if (selectedModel === model) {
        await Promise.resolve(onSelectModel("", { silent: true }));
      }
      await Promise.resolve(onRefreshModels({ silent: true }));
    } catch (operationError) {
      const message =
        operationError instanceof Error
          ? operationError.message
          : "Model delete failed.";
      setError(message);
      showToast({
        id: "model-operation",
        title: "Model delete failed",
        description: message,
        tone: "danger",
        duration: 7000
      });
    } finally {
      setOperation(null);
    }
  };

  return (
    <div className="space-y-3">
      {error ? <ModelNotice tone="danger">{error}</ModelNotice> : null}
      {success ? <ModelNotice tone="success">{success}</ModelNotice> : null}
      {status || progress ? <OperationStatus status={status} progress={progress} /> : null}

      <div className="rounded-md border border-border bg-panel-strong px-3 py-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Download className="h-4 w-4 text-accent" />
          Add Model
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={pullName}
            disabled={busy}
            onChange={(event) => setPullName(event.target.value)}
            placeholder="llama3.2 or x/flux2-klein"
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
          />
          <button
            type="button"
            disabled={!canPull}
            onClick={handlePull}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-accent/45 bg-accent px-3 text-sm font-medium text-accent-foreground transition hover:bg-accent/90 focus:focus-ring disabled:opacity-55"
          >
            <Plus className="h-4 w-4" />
            Pull
          </button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-panel-strong px-3 py-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Wand2 className="h-4 w-4 text-accent" />
          Create Model
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={createName}
            disabled={busy}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="new-model-name"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
          />
          <select
            value={createBase}
            disabled={busy || localModels.length === 0}
            onChange={(event) => setCreateBase(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
          >
            {localModels.length === 0 ? <option value="">No local base models</option> : null}
            {localModels.map((model) => (
              <option key={model.name} value={model.name}>
                {model.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm font-medium">
          System Prompt
        </div>
        <textarea
          value={createSystem}
          disabled={busy}
          onChange={(event) => setCreateSystem(event.target.value)}
          title="System prompt"
          placeholder={DEFAULT_CREATE_PARAMETERS.systemPrompt}
          rows={3}
          className="mt-2 block w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:focus-ring disabled:opacity-55"
        />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input
            title="temperature"
            aria-label="temperature"
            value={temperature}
            disabled={busy}
            onChange={(event) => setTemperature(event.target.value)}
            inputMode="decimal"
            placeholder={DEFAULT_CREATE_PARAMETERS.temperature}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
          />
          <input
            title="num_ctx"
            aria-label="num_ctx"
            value={contextLength}
            disabled={busy}
            onChange={(event) => setContextLength(event.target.value)}
            inputMode="numeric"
            placeholder={DEFAULT_CREATE_PARAMETERS.contextLength}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
          />
          <input
            title="top_p"
            aria-label="top_p"
            value={topP}
            disabled={busy}
            onChange={(event) => setTopP(event.target.value)}
            inputMode="decimal"
            placeholder={DEFAULT_CREATE_PARAMETERS.topP}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
          />
          <input
            title="repeat_penalty"
            aria-label="repeat_penalty"
            value={repeatPenalty}
            disabled={busy}
            onChange={(event) => setRepeatPenalty(event.target.value)}
            inputMode="decimal"
            placeholder={DEFAULT_CREATE_PARAMETERS.repeatPenalty}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
          />
        </div>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={!canCreate}
            onClick={handleCreate}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition hover:bg-muted focus:focus-ring disabled:opacity-55"
          >
            <Wand2 className="h-4 w-4" />
            Create
          </button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-panel-strong px-3 py-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <FileArchive className="h-4 w-4 text-accent" />
          Import GGUF
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gguf,application/octet-stream"
          onChange={handleImportFile}
          className="hidden"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={importName}
            disabled={busy}
            onChange={(event) => setImportName(event.target.value)}
            placeholder="imported-model-name"
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm transition hover:bg-muted focus:focus-ring disabled:opacity-55"
          >
            <FileArchive className="h-4 w-4" />
            {importFile ? "Change" : "Choose"}
          </button>
          <button
            type="button"
            disabled={!canImport}
            onClick={() => void handleImport()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition hover:bg-muted focus:focus-ring disabled:opacity-55"
          >
            Import
          </button>
        </div>
        {importFile ? (
          <div className="mt-2 truncate text-xs text-muted-foreground">
            {importFile.name} - {formatBytes(importFile.size)}
          </div>
        ) : null}
      </div>

      <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-danger">
          <Trash2 className="h-4 w-4" />
          Delete Model
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={deleteName}
            disabled={busy || localModels.length === 0}
            onChange={(event) => {
              setDeleteName(event.target.value);
              setConfirmDelete(false);
            }}
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
          >
            {localModels.length === 0 ? <option value="">No local models</option> : null}
            {localModels.map((model) => (
              <option key={model.name} value={model.name}>
                {model.displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !deleteName}
            onClick={() => setConfirmDelete((current) => !current)}
            className={cn(
              "inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm transition focus:focus-ring disabled:opacity-55",
              confirmDelete
                ? "border-danger/50 bg-danger/15 text-danger"
                : "border-border hover:bg-muted"
            )}
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={!canDelete}
            onClick={() => void handleDelete()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-danger/50 bg-danger px-3 text-sm font-medium text-background transition hover:bg-danger/90 focus:focus-ring disabled:opacity-55"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function OperationStatus({
  status,
  progress
}: {
  status: string | null;
  progress: { completed: number; total: number } | null;
}) {
  const percent = progress
    ? Math.round((progress.completed / Math.max(progress.total, 1)) * 100)
    : null;

  return (
    <div className="rounded-md border border-border bg-panel-strong px-3 py-2 text-sm">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="truncate text-muted-foreground">{status ?? "Working"}</span>
        {percent !== null ? <span>{percent}%</span> : <RefreshCcw className="h-4 w-4 animate-spin" />}
      </div>
      {percent !== null ? (
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function ModelNotice({
  tone,
  children
}: {
  tone: "danger" | "success";
  children: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        tone === "danger" && "border-danger/30 bg-danger/10 text-danger",
        tone === "success" && "border-success/30 bg-success/10 text-success"
      )}
    >
      {children}
    </div>
  );
}

function modelOperationStartTitle(kind: OperationKind) {
  if (kind === "pull") return "Pulling model";
  if (kind === "create") return "Creating model";
  if (kind === "delete") return "Deleting model";
  return "Importing model";
}

function modelOperationSuccessTitle(kind: OperationKind) {
  if (kind === "pull") return "Model added";
  if (kind === "create") return "Model created";
  if (kind === "delete") return "Model deleted";
  return "Model imported";
}

function modelOperationErrorTitle(kind: OperationKind) {
  if (kind === "pull") return "Model pull failed";
  if (kind === "create") return "Model create failed";
  if (kind === "delete") return "Model delete failed";
  return "Model import failed";
}

function modelParameters({
  temperature,
  contextLength,
  topP,
  repeatPenalty
}: {
  temperature: string;
  contextLength: string;
  topP: string;
  repeatPenalty: string;
}) {
  const parameters: Record<string, number> = {};

  addNumericParameter(parameters, "temperature", temperature);
  addNumericParameter(parameters, "num_ctx", contextLength, true);
  addNumericParameter(parameters, "top_p", topP);
  addNumericParameter(parameters, "repeat_penalty", repeatPenalty);

  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

function addNumericParameter(
  parameters: Record<string, number>,
  key: string,
  value: string,
  integer = false
) {
  if (!value.trim()) return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  parameters[key] = integer ? Math.max(1, Math.round(parsed)) : parsed;
}

async function sha256Digest(file: File) {
  if (!crypto.subtle) {
    throw new Error("This browser does not support Web Crypto file hashing.");
  }

  const hashBuffer = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return `sha256:${hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
