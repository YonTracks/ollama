"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  BrainCircuit,
  ChevronDown,
  Download,
  Eye,
  FileArchive,
  FileText,
  Loader2,
  Plus,
  RefreshCcw,
  Trash2,
  Wand2
} from "lucide-react";
import { showModel } from "@/lib/ollama/client";
import { createRequestFromModelfile } from "@/lib/ollama/modelfile";
import {
  showStandaloneModel,
  type CreateStandaloneModelRequest
} from "@/lib/ollama/standalone";
import { useToast } from "@/components/ui/ToastProvider";
import { cn, formatBytes } from "@/lib/utils";
import type { ModelOperationsController } from "@/hooks/useModelOperations";
import type { OllamaModel, OllamaShowModelResponse } from "@/lib/ollama/types";

interface ModelManagerProps {
  models: OllamaModel[];
  selectedModel: string;
  standalone?: boolean;
  apiBase?: string;
  apiToken?: string;
  modelOperations: ModelOperationsController;
}

type CreateMode = "fields" | "modelfile";

const DEFAULT_CREATE_PARAMETERS = {
  systemPrompt: "You are Mario from Super Mario Bros, acting as an assistant.",
  temperature: "0.7",
  contextLength: "4096",
  topP: "0.9",
  topK: "",
  minP: "",
  repeatPenalty: "1.1",
  repeatLastN: "",
  numPredict: "",
  seed: "",
  stopSequences: "",
  template: "",
  quantize: "",
  requires: ""
};

const EXPERT_CREATE_PARAMETERS = {
  systemPrompt:
    "You are a careful expert assistant. Ground answers in provided context, use retrieval memory when available, ask for missing details when needed, and keep recommendations precise and actionable.",
  temperature: "0.3",
  contextLength: "8192",
  topP: "0.85",
  topK: "40",
  repeatPenalty: "1.08"
};

const DEFAULT_MODELFILE = `FROM llama3.2
PARAMETER temperature 0.7
PARAMETER num_ctx 4096
SYSTEM You are a helpful assistant.`;

export function ModelManager({
  models,
  selectedModel,
  standalone = false,
  apiBase,
  apiToken,
  modelOperations
}: ModelManagerProps) {
  const { showToast } = useToast();
  const localModels = useMemo(() => models.filter((model) => model.local), [models]);
  const firstLocalModel = localModels[0]?.name ?? selectedModel;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);

  const [pullName, setPullName] = useState("");
  const [detailsName, setDetailsName] = useState(firstLocalModel);
  const [detailsVerbose, setDetailsVerbose] = useState(false);
  const [modelDetails, setModelDetails] = useState<OllamaShowModelResponse | null>(null);
  const [modelDetailsLoading, setModelDetailsLoading] = useState(false);
  const [modelDetailsError, setModelDetailsError] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>("fields");
  const [createAdvancedOpen, setCreateAdvancedOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBase, setCreateBase] = useState(firstLocalModel);
  const [createSystem, setCreateSystem] = useState(DEFAULT_CREATE_PARAMETERS.systemPrompt);
  const [createTemplate, setCreateTemplate] = useState(DEFAULT_CREATE_PARAMETERS.template);
  const [createModelfile, setCreateModelfile] = useState(DEFAULT_MODELFILE);
  const [temperature, setTemperature] = useState(DEFAULT_CREATE_PARAMETERS.temperature);
  const [contextLength, setContextLength] = useState(DEFAULT_CREATE_PARAMETERS.contextLength);
  const [topP, setTopP] = useState(DEFAULT_CREATE_PARAMETERS.topP);
  const [topK, setTopK] = useState(DEFAULT_CREATE_PARAMETERS.topK);
  const [minP, setMinP] = useState(DEFAULT_CREATE_PARAMETERS.minP);
  const [repeatPenalty, setRepeatPenalty] = useState(
    DEFAULT_CREATE_PARAMETERS.repeatPenalty
  );
  const [repeatLastN, setRepeatLastN] = useState(DEFAULT_CREATE_PARAMETERS.repeatLastN);
  const [numPredict, setNumPredict] = useState(DEFAULT_CREATE_PARAMETERS.numPredict);
  const [seed, setSeed] = useState(DEFAULT_CREATE_PARAMETERS.seed);
  const [stopSequences, setStopSequences] = useState(DEFAULT_CREATE_PARAMETERS.stopSequences);
  const [quantize, setQuantize] = useState(DEFAULT_CREATE_PARAMETERS.quantize);
  const [requires, setRequires] = useState(DEFAULT_CREATE_PARAMETERS.requires);
  const [importName, setImportName] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [deleteName, setDeleteName] = useState(firstLocalModel);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { snapshot } = modelOperations;
  const busy = snapshot.operation !== null;
  const canPull = pullName.trim().length > 0 && !busy;
  const canShowDetails = detailsName.trim().length > 0 && !modelDetailsLoading;
  const canCreate =
    createName.trim().length > 0 &&
    !busy &&
    (createMode === "modelfile"
      ? createModelfile.trim().length > 0
      : createBase.trim().length > 0);
  const canImport = importName.trim().length > 0 && importFile && !busy;
  const canDelete = deleteName.trim().length > 0 && confirmDelete && !busy;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const hasCreateBase = localModels.some((model) => model.name === createBase);
    const hasDeleteName = localModels.some((model) => model.name === deleteName);
    const hasDetailsName = localModels.some((model) => model.name === detailsName);

    if (firstLocalModel && !hasCreateBase) setCreateBase(firstLocalModel);
    if (!firstLocalModel && createBase) setCreateBase("");
    if (firstLocalModel && !hasDetailsName) setDetailsName(firstLocalModel);
    if (!firstLocalModel && detailsName) setDetailsName("");
    if (firstLocalModel && !hasDeleteName) setDeleteName(firstLocalModel);
    if (!firstLocalModel && deleteName) setDeleteName("");
  }, [createBase, deleteName, detailsName, firstLocalModel, localModels]);

  const handlePull = () => {
    const model = pullName.trim();
    if (!model) return;
    setFormError(null);
    modelOperations.clearNotices();
    void modelOperations.pullModel(model);
  };

  const handleShowDetails = async () => {
    const model = detailsName.trim();
    if (!model) return;

    setModelDetailsLoading(true);
    setModelDetailsError(null);
    setModelDetails(null);

    try {
      const details = standalone
        ? await showStandaloneModel(model, apiBase, apiToken, undefined, {
            verbose: detailsVerbose
          })
        : await showModel(model, undefined, { verbose: detailsVerbose });
      setModelDetails(details);
    } catch (detailsError) {
      const message =
        detailsError instanceof Error ? detailsError.message : "Model details could not be loaded.";
      setModelDetailsError(message);
      showToast({
        id: "model-details",
        title: "Model details failed",
        description: message,
        tone: "danger",
        duration: 7000
      });
    } finally {
      setModelDetailsLoading(false);
    }
  };

  const useDetailsModelfileForCreate = () => {
    if (!modelDetails?.modelfile) return;
    setCreateMode("modelfile");
    setCreateAdvancedOpen(false);
    setCreateModelfile(modelDetails.modelfile);
    if (!createName.trim()) {
      setCreateName(`${detailsName.replace(/:latest$/, "")}-custom`);
    }
    showToast({
      id: "model-details-modelfile",
      title: "Modelfile loaded",
      description: "Create Model is ready to edit.",
      tone: "info",
      duration: 3000
    });
  };

  const handleCreate = () => {
    const model = createName.trim();
    if (!model) return;
    setFormError(null);
    modelOperations.clearNotices();

    let request: CreateStandaloneModelRequest;
    try {
      request =
        createMode === "modelfile"
          ? createRequestFromModelfile(model, createModelfile)
          : {
              model,
              from: createBase.trim(),
              template: createTemplate.trim() || undefined,
              system: createSystem.trim() || undefined,
              quantize: quantize.trim() || undefined,
              requires: requires.trim() || undefined,
              parameters: modelParameters({
                temperature,
                contextLength,
                topP,
                topK,
                minP,
                repeatPenalty,
                repeatLastN,
                numPredict,
                seed,
                stopSequences
              })
            };
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : "Model create configuration is invalid.";
      setFormError(message);
      showToast({
        id: "model-create-config",
        title: "Model create needs changes",
        description: message,
        tone: "danger",
        duration: 7000
      });
      return;
    }

    void modelOperations.createModel(request);
  };

  const applyExpertTemplate = () => {
    setCreateSystem(EXPERT_CREATE_PARAMETERS.systemPrompt);
    setTemperature(EXPERT_CREATE_PARAMETERS.temperature);
    setContextLength(EXPERT_CREATE_PARAMETERS.contextLength);
    setTopP(EXPERT_CREATE_PARAMETERS.topP);
    setTopK(EXPERT_CREATE_PARAMETERS.topK);
    setRepeatPenalty(EXPERT_CREATE_PARAMETERS.repeatPenalty);
    setCreateAdvancedOpen(true);
    showToast({
      id: "model-expert-template",
      title: "Expert template applied",
      description: "The create model fields were updated.",
      tone: "info",
      duration: 3000
    });
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

  const handleImport = () => {
    const model = importName.trim();
    if (!model || !importFile) return;

    setFormError(null);
    modelOperations.clearNotices();
    void modelOperations.importModel(model, importFile).then((imported) => {
      if (imported && mountedRef.current) setImportFile(null);
    });
  };

  const handleDelete = () => {
    const model = deleteName.trim();
    if (!model || !confirmDelete) return;

    setFormError(null);
    modelOperations.clearNotices();
    void modelOperations.deleteModel(model).then((deleted) => {
      if (!deleted || !mountedRef.current) return;
      setConfirmDelete(false);
      setDeleteName("");
    });
  };

  return (
    <div className="space-y-3">
      {formError ? <ModelNotice tone="danger">{formError}</ModelNotice> : null}
      {snapshot.error ? <ModelNotice tone="danger">{snapshot.error}</ModelNotice> : null}
      {snapshot.success ? <ModelNotice tone="success">{snapshot.success}</ModelNotice> : null}
      {snapshot.status || snapshot.progress ? (
        <OperationStatus status={snapshot.status} progress={snapshot.progress} />
      ) : null}

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
          <Eye className="h-4 w-4 text-accent" />
          Show Model Details
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={detailsName}
            disabled={localModels.length === 0 || modelDetailsLoading}
            onChange={(event) => {
              setDetailsName(event.target.value);
              setModelDetails(null);
              setModelDetailsError(null);
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
          <label className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={detailsVerbose}
              disabled={modelDetailsLoading}
              onChange={(event) => setDetailsVerbose(event.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Verbose
          </label>
          <button
            type="button"
            disabled={!canShowDetails}
            onClick={() => void handleShowDetails()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition hover:bg-muted focus:focus-ring disabled:opacity-55"
          >
            {modelDetailsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
            Show
          </button>
        </div>

        {modelDetailsError ? (
          <div className="mt-2 text-sm text-danger">{modelDetailsError}</div>
        ) : null}

        {modelDetails ? (
          <div className="mt-3 space-y-3 text-sm">
            <ModelDetailsSummary details={modelDetails} />

            {modelDetails.modelfile ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <FileText className="h-4 w-4 text-accent" />
                    <span>Modelfile</span>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={useDetailsModelfileForCreate}
                    className="inline-flex h-8 flex-none items-center justify-center gap-2 rounded-md border border-border px-2 text-xs transition hover:bg-muted focus:focus-ring disabled:opacity-55"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    Use
                  </button>
                </div>
                <textarea
                  readOnly
                  value={modelDetails.modelfile}
                  rows={12}
                  className="block w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none"
                />
              </div>
            ) : null}

            <ModelDetailsTextBlock title="Parameters" value={modelDetails.parameters} />
            <ModelDetailsTextBlock title="Template" value={modelDetails.template} />
            <ModelDetailsTextBlock title="System" value={modelDetails.system} />

            {modelDetails.model_info ? (
              <details className="border-t border-border pt-2">
                <summary className="cursor-pointer text-sm font-medium">
                  Model Info
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-background px-3 py-2 text-xs">
                  {JSON.stringify(modelDetails.model_info, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-md border border-border bg-panel-strong px-3 py-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Wand2 className="h-4 w-4 text-accent" />
          Create Model
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_13rem]">
          <input
            value={createName}
            disabled={busy}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="new-model-name"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
          />
          <select
            value={createMode}
            disabled={busy}
            onChange={(event) => setCreateMode(event.target.value as CreateMode)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
          >
            <option value="fields">Structured fields</option>
            <option value="modelfile">Modelfile</option>
          </select>
        </div>

        {createMode === "fields" ? (
          <>
            <select
              value={createBase}
              disabled={busy || localModels.length === 0}
              onChange={(event) => setCreateBase(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
            >
              {localModels.length === 0 ? <option value="">No local base models</option> : null}
              {localModels.map((model) => (
                <option key={model.name} value={model.name}>
                  {model.displayName}
                </option>
              ))}
            </select>
            <div className="mt-2 flex items-center gap-2 text-sm font-medium">
              <span className="min-w-0 flex-1">System Prompt</span>
              <button
                type="button"
                disabled={busy}
                onClick={applyExpertTemplate}
                className="inline-flex h-8 flex-none items-center justify-center gap-2 rounded-md border border-border px-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground focus:focus-ring disabled:opacity-55"
              >
                <BrainCircuit className="h-3.5 w-3.5" />
                Expert
              </button>
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
          </>
        ) : (
          <textarea
            value={createModelfile}
            disabled={busy}
            onChange={(event) => setCreateModelfile(event.target.value)}
            title="Modelfile"
            rows={10}
            className="mt-2 block w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:focus-ring disabled:opacity-55"
          />
        )}

        {createMode === "fields" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setCreateAdvancedOpen((current) => !current)}
            className="mt-2 inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus:focus-ring disabled:opacity-55"
            aria-expanded={createAdvancedOpen}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                createAdvancedOpen ? "rotate-180" : "rotate-0"
              )}
            />
            Advanced
          </button>
        ) : null}

        {createAdvancedOpen && createMode === "fields" ? (
          <div className="mt-2 border-t border-border pt-3">
            <textarea
              value={createTemplate}
              disabled={busy}
              onChange={(event) => setCreateTemplate(event.target.value)}
              title="template"
              aria-label="template"
              rows={4}
              placeholder="TEMPLATE"
              className="block w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:focus-ring disabled:opacity-55"
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <ModelParameterInput
                label="temperature"
                value={temperature}
                disabled={busy}
                inputMode="decimal"
                placeholder={DEFAULT_CREATE_PARAMETERS.temperature}
                onChange={setTemperature}
              />
              <ModelParameterInput
                label="num_ctx"
                value={contextLength}
                disabled={busy}
                inputMode="numeric"
                placeholder={DEFAULT_CREATE_PARAMETERS.contextLength}
                onChange={setContextLength}
              />
              <ModelParameterInput
                label="top_p"
                value={topP}
                disabled={busy}
                inputMode="decimal"
                placeholder={DEFAULT_CREATE_PARAMETERS.topP}
                onChange={setTopP}
              />
              <ModelParameterInput
                label="top_k"
                value={topK}
                disabled={busy}
                inputMode="numeric"
                placeholder="40"
                onChange={setTopK}
              />
              <ModelParameterInput
                label="min_p"
                value={minP}
                disabled={busy}
                inputMode="decimal"
                placeholder="0.05"
                onChange={setMinP}
              />
              <ModelParameterInput
                label="repeat_penalty"
                value={repeatPenalty}
                disabled={busy}
                inputMode="decimal"
                placeholder={DEFAULT_CREATE_PARAMETERS.repeatPenalty}
                onChange={setRepeatPenalty}
              />
              <ModelParameterInput
                label="repeat_last_n"
                value={repeatLastN}
                disabled={busy}
                inputMode="numeric"
                placeholder="64"
                onChange={setRepeatLastN}
              />
              <ModelParameterInput
                label="num_predict"
                value={numPredict}
                disabled={busy}
                inputMode="numeric"
                placeholder="-1"
                onChange={setNumPredict}
              />
              <ModelParameterInput
                label="seed"
                value={seed}
                disabled={busy}
                inputMode="numeric"
                placeholder="42"
                onChange={setSeed}
              />
              <ModelParameterInput
                label="quantize"
                value={quantize}
                disabled={busy}
                placeholder="q4_K_M"
                onChange={setQuantize}
              />
              <ModelParameterInput
                label="requires"
                value={requires}
                disabled={busy}
                placeholder="0.14.0"
                onChange={setRequires}
              />
            </div>
            <textarea
              value={stopSequences}
              disabled={busy}
              onChange={(event) => setStopSequences(event.target.value)}
              title="stop"
              aria-label="stop"
              rows={3}
              placeholder="stop sequences, one per line"
              className="mt-2 block w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:focus-ring disabled:opacity-55"
            />
          </div>
        ) : null}

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

function ModelDetailsSummary({ details }: { details: OllamaShowModelResponse }) {
  const modelDetails = details.details;
  const rows = [
    ["Family", modelDetails?.family],
    ["Families", modelDetails?.families?.join(", ")],
    ["Format", modelDetails?.format],
    ["Parameters", modelDetails?.parameter_size],
    ["Quantization", modelDetails?.quantization_level],
    ["Capabilities", details.capabilities?.join(", ")],
    ["Modified", formatDateTime(details.modified_at)],
    ["Requires", details.requires],
    ["Remote", details.remote_model || details.remote_host]
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (rows.length === 0) return null;

  return (
    <div className="grid gap-x-4 gap-y-2 border-y border-border py-2 text-xs sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">{label}</span>
          <span className="min-w-0 truncate font-medium">{value}</span>
        </div>
      ))}
    </div>
  );
}

function ModelDetailsTextBlock({ title, value }: { title: string; value?: string }) {
  if (!value?.trim()) return null;
  return (
    <details className="border-t border-border pt-2">
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2 text-xs">
        {value}
      </pre>
    </details>
  );
}

function ModelParameterInput({
  label,
  value,
  disabled,
  inputMode,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  disabled: boolean;
  inputMode?: "decimal" | "numeric";
  placeholder?: string;
  onChange(value: string): void;
}) {
  return (
    <input
      title={label}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      inputMode={inputMode}
      placeholder={placeholder}
      className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:focus-ring disabled:opacity-55"
    />
  );
}

function formatDateTime(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function modelParameters({
  temperature,
  contextLength,
  topP,
  topK,
  minP,
  repeatPenalty,
  repeatLastN,
  numPredict,
  seed,
  stopSequences
}: {
  temperature: string;
  contextLength: string;
  topP: string;
  topK: string;
  minP: string;
  repeatPenalty: string;
  repeatLastN: string;
  numPredict: string;
  seed: string;
  stopSequences: string;
}) {
  const parameters: Record<string, number | string[]> = {};

  addNumericParameter(parameters, "temperature", temperature);
  addNumericParameter(parameters, "num_ctx", contextLength, true);
  addNumericParameter(parameters, "top_p", topP);
  addNumericParameter(parameters, "top_k", topK, true);
  addNumericParameter(parameters, "min_p", minP);
  addNumericParameter(parameters, "repeat_penalty", repeatPenalty);
  addNumericParameter(parameters, "repeat_last_n", repeatLastN, true);
  addNumericParameter(parameters, "num_predict", numPredict, true);
  addNumericParameter(parameters, "seed", seed, true);
  addStopParameters(parameters, stopSequences);

  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

function addNumericParameter(
  parameters: Record<string, number | string[]>,
  key: string,
  value: string,
  integer = false
) {
  if (!value.trim()) return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  parameters[key] = integer ? Math.round(parsed) : parsed;
}

function addStopParameters(parameters: Record<string, number | string[]>, value: string) {
  const stops = value
    .split(/\r?\n/)
    .map((stop) => stop.trim())
    .filter(Boolean);
  if (stops.length > 0) {
    parameters.stop = stops;
  }
}
