"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { cn, createClientId } from "@/lib/utils";

type ToastTone = "info" | "success" | "warning" | "danger";

interface ToastAction {
  label: string;
  onClick(): void;
}

interface ToastInput {
  id?: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number | false;
  action?: ToastAction;
  onDismiss?: () => void;
}

interface Toast extends ToastInput {
  id: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast(input: ToastInput): string;
  dismissToast(id: string): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const DEFAULT_TOAST_DURATION = 4200;
const MAX_TOASTS = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastsRef = useRef(toasts);

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  const dismissToast = useCallback((id: string) => {
    const dismissed = toastsRef.current.find((toast) => toast.id === id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
    dismissed?.onDismiss?.();
  }, []);

  const showToast = useCallback((input: ToastInput) => {
    const id = input.id ?? createClientId("toast");
    const toast: Toast = {
      ...input,
      id,
      tone: input.tone ?? "info"
    };

    setToasts((current) =>
      [toast, ...current.filter((item) => item.id !== id)].slice(0, MAX_TOASTS)
    );

    return id;
  }, []);

  const value = useMemo(
    () => ({
      dismissToast,
      showToast
    }),
    [dismissToast, showToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider.");
  }

  return context;
}

function ToastViewport({
  toasts,
  onDismiss
}: {
  toasts: Toast[];
  onDismiss(id: string): void;
}) {
  return (
    <div
      className="toast-safe-bottom pointer-events-none fixed left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-4 sm:w-96 sm:translate-x-0"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss
}: {
  toast: Toast;
  onDismiss(id: string): void;
}) {
  useEffect(() => {
    if (toast.duration === false) return;

    const timeout = window.setTimeout(
      () => onDismiss(toast.id),
      toast.duration ?? DEFAULT_TOAST_DURATION
    );

    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast.duration, toast.id]);

  return (
    <div
      role={toast.tone === "danger" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto rounded-md border bg-panel p-3 text-sm shadow-panel",
        "transition duration-200",
        toast.tone === "info" && "border-border text-foreground",
        toast.tone === "success" && "border-success/35 text-success",
        toast.tone === "warning" && "border-warning/40 text-warning",
        toast.tone === "danger" && "border-danger/40 text-danger"
      )}
    >
      <div className="flex gap-3">
        {toastIcon(toast.tone)}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">{toast.title}</div>
          {toast.description ? (
            <div className="mt-0.5 break-words text-muted-foreground">
              {toast.description}
            </div>
          ) : null}
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                onDismiss(toast.id);
              }}
              className="mt-3 inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground transition hover:bg-accent/90 focus:focus-ring"
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={`Dismiss ${toast.title}`}
          title={`Dismiss ${toast.title}`}
          onClick={() => onDismiss(toast.id)}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus:focus-ring"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function toastIcon(tone: ToastTone) {
  const className = "mt-0.5 h-4 w-4 flex-none";
  if (tone === "success") return <CheckCircle2 className={className} />;
  if (tone === "warning") return <AlertTriangle className={className} />;
  if (tone === "danger") return <XCircle className={className} />;
  return <Info className={className} />;
}
