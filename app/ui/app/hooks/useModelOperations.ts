"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/ToastProvider";
import {
  createStandaloneModel,
  deleteStandaloneModel,
  pullStandaloneModel,
  standaloneBlobExists,
  uploadStandaloneBlob,
  type CreateStandaloneModelRequest
} from "@/lib/ollama/standalone";
import { formatBytes } from "@/lib/utils";
import type { ModelOperationEvent } from "@/lib/ollama/types";

interface ToastOptions {
  silent?: boolean;
}

export type ModelOperationKind = "pull" | "create" | "import" | "delete";

export interface ModelOperationSnapshot {
  operation: ModelOperationKind | null;
  model: string | null;
  status: string | null;
  progress: { completed: number; total: number } | null;
  error: string | null;
  success: string | null;
}

export interface ModelOperationsController {
  snapshot: ModelOperationSnapshot;
  clearNotices(): void;
  pullModel(model: string): Promise<boolean>;
  createModel(request: CreateStandaloneModelRequest): Promise<boolean>;
  importModel(model: string, file: File): Promise<boolean>;
  deleteModel(model: string): Promise<boolean>;
}

interface UseModelOperationsOptions {
  apiBase?: string;
  apiToken?: string;
  selectedModel: string;
  onSelectModel(model: string, options?: ToastOptions): Promise<boolean | void> | boolean | void;
  onRefreshModels(options?: ToastOptions): Promise<boolean | void> | boolean | void;
}

const EMPTY_SNAPSHOT: ModelOperationSnapshot = {
  operation: null,
  model: null,
  status: null,
  progress: null,
  error: null,
  success: null
};

export function useModelOperations({
  apiBase,
  apiToken,
  selectedModel,
  onSelectModel,
  onRefreshModels
}: UseModelOperationsOptions): ModelOperationsController {
  const { showToast } = useToast();
  const [snapshot, setSnapshot] = useState<ModelOperationSnapshot>(EMPTY_SNAPSHOT);
  const activeOperationIdRef = useRef<number | null>(null);
  const nextOperationIdRef = useRef(0);
  const callbacksRef = useRef({
    selectedModel,
    onSelectModel,
    onRefreshModels
  });

  useEffect(() => {
    callbacksRef.current = {
      selectedModel,
      onSelectModel,
      onRefreshModels
    };
  }, [onRefreshModels, onSelectModel, selectedModel]);

  const updateActive = useCallback(
    (
      operationId: number,
      updater: (current: ModelOperationSnapshot) => ModelOperationSnapshot
    ) => {
      if (activeOperationIdRef.current !== operationId) return;
      setSnapshot((current) => updater(current));
    },
    []
  );

  const beginOperation = useCallback(
    (kind: ModelOperationKind, model: string) => {
      if (activeOperationIdRef.current !== null) {
        showToast({
          id: "model-operation",
          title: "Model operation already running",
          description: snapshot.model ?? "Wait for the current operation to finish.",
          tone: "warning",
          duration: 5000
        });
        return null;
      }

      const operationId = nextOperationIdRef.current + 1;
      nextOperationIdRef.current = operationId;
      activeOperationIdRef.current = operationId;
      setSnapshot({
        operation: kind,
        model,
        status: "Starting",
        progress: null,
        error: null,
        success: null
      });
      showToast({
        id: "model-operation",
        title: modelOperationStartTitle(kind),
        description: model,
        tone: "info",
        duration: 5000
      });

      return operationId;
    },
    [showToast, snapshot.model]
  );

  const applyEvent = useCallback(
    (operationId: number, event: ModelOperationEvent) => {
      updateActive(operationId, (current) => ({
        ...current,
        error: event.error ?? current.error,
        status: event.status || current.status,
        progress:
          typeof event.completed === "number" && typeof event.total === "number"
            ? { completed: event.completed, total: event.total }
            : current.progress
      }));
    },
    [updateActive]
  );

  const finishSuccess = useCallback(
    async (
      operationId: number,
      kind: ModelOperationKind,
      model: string,
      completeMessage: string,
      modelToSelect?: string
    ) => {
      if (activeOperationIdRef.current !== operationId) return false;

      updateActive(operationId, (current) => ({
        ...current,
        operation: null,
        status: "Complete",
        success: completeMessage,
        error: null
      }));
      activeOperationIdRef.current = null;
      showToast({
        id: "model-operation",
        title: modelOperationSuccessTitle(kind),
        description: completeMessage,
        tone: "success"
      });

      const callbacks = callbacksRef.current;
      if (modelToSelect) await Promise.resolve(callbacks.onSelectModel(modelToSelect, { silent: true }));
      if (kind === "delete" && callbacks.selectedModel === model) {
        await Promise.resolve(callbacks.onSelectModel("", { silent: true }));
      }
      await Promise.resolve(callbacks.onRefreshModels({ silent: true }));
      return true;
    },
    [showToast, updateActive]
  );

  const finishError = useCallback(
    (operationId: number, kind: ModelOperationKind, error: unknown) => {
      if (activeOperationIdRef.current !== operationId) return false;

      const message = error instanceof Error ? error.message : "Model operation failed.";
      updateActive(operationId, (current) => ({
        ...current,
        operation: null,
        error: message
      }));
      activeOperationIdRef.current = null;
      showToast({
        id: "model-operation",
        title: modelOperationErrorTitle(kind),
        description: message,
        tone: "danger",
        duration: 7000
      });
      return false;
    },
    [showToast, updateActive]
  );

  const runStreamOperation = useCallback(
    async (
      kind: ModelOperationKind,
      model: string,
      stream: AsyncGenerator<ModelOperationEvent>,
      completeMessage: string,
      modelToSelect?: string
    ) => {
      const operationId = beginOperation(kind, model);
      if (operationId === null) return false;

      try {
        for await (const event of stream) {
          if (event.error) throw new Error(event.error);
          applyEvent(operationId, event);
        }

        return await finishSuccess(
          operationId,
          kind,
          model,
          completeMessage,
          modelToSelect
        );
      } catch (error) {
        return finishError(operationId, kind, error);
      }
    },
    [applyEvent, beginOperation, finishError, finishSuccess]
  );

  const pullModel = useCallback(
    async (model: string) => {
      return runStreamOperation(
        "pull",
        model,
        pullStandaloneModel(model, apiBase, apiToken),
        `${model} added`,
        model
      );
    },
    [apiBase, apiToken, runStreamOperation]
  );

  const createModel = useCallback(
    async (request: CreateStandaloneModelRequest) => {
      return runStreamOperation(
        "create",
        request.model,
        createStandaloneModel(request, apiBase, apiToken),
        `${request.model} created`,
        request.model
      );
    },
    [apiBase, apiToken, runStreamOperation]
  );

  const importModel = useCallback(
    async (model: string, file: File) => {
      const operationId = beginOperation("import", model);
      if (operationId === null) return false;

      try {
        updateActive(operationId, (current) => ({
          ...current,
          status: `Hashing ${file.name}`
        }));
        const digest = await sha256Digest(file);

        updateActive(operationId, (current) => ({
          ...current,
          status: "Checking blob cache"
        }));
        if (!(await standaloneBlobExists(digest, apiBase, apiToken))) {
          updateActive(operationId, (current) => ({
            ...current,
            status: `Uploading ${formatBytes(file.size)}`
          }));
          await uploadStandaloneBlob(digest, file, apiBase, apiToken);
        }

        updateActive(operationId, (current) => ({
          ...current,
          status: "Creating model"
        }));
        for await (const event of createStandaloneModel({
          model,
          files: {
            [file.name]: digest
          }
        }, apiBase, apiToken)) {
          if (event.error) throw new Error(event.error);
          applyEvent(operationId, event);
        }

        return await finishSuccess(operationId, "import", model, `${model} imported`, model);
      } catch (error) {
        return finishError(operationId, "import", error);
      }
    },
    [apiBase, apiToken, applyEvent, beginOperation, finishError, finishSuccess, updateActive]
  );

  const deleteModel = useCallback(
    async (model: string) => {
      const operationId = beginOperation("delete", model);
      if (operationId === null) return false;

      try {
        updateActive(operationId, (current) => ({
          ...current,
          status: "Deleting model"
        }));
        await deleteStandaloneModel(model, apiBase, apiToken);
        return await finishSuccess(operationId, "delete", model, `${model} deleted`);
      } catch (error) {
        return finishError(operationId, "delete", error);
      }
    },
    [apiBase, apiToken, beginOperation, finishError, finishSuccess, updateActive]
  );

  const clearNotices = useCallback(() => {
    if (activeOperationIdRef.current !== null) return;
    setSnapshot(EMPTY_SNAPSHOT);
  }, []);

  return {
    snapshot,
    clearNotices,
    pullModel,
    createModel,
    importModel,
    deleteModel
  };
}

function modelOperationStartTitle(kind: ModelOperationKind) {
  if (kind === "pull") return "Pulling model";
  if (kind === "create") return "Creating model";
  if (kind === "delete") return "Deleting model";
  return "Importing model";
}

function modelOperationSuccessTitle(kind: ModelOperationKind) {
  if (kind === "pull") return "Model added";
  if (kind === "create") return "Model created";
  if (kind === "delete") return "Model deleted";
  return "Model imported";
}

function modelOperationErrorTitle(kind: ModelOperationKind) {
  if (kind === "pull") return "Model pull failed";
  if (kind === "create") return "Model create failed";
  if (kind === "delete") return "Model delete failed";
  return "Model import failed";
}

async function sha256Digest(file: File) {
  if (!crypto.subtle) {
    throw new Error("This browser does not support Web Crypto file hashing.");
  }

  const hashBuffer = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return `sha256:${hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
