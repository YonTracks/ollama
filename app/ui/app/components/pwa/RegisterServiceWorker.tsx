"use client";

import { RefreshCcw, X } from "lucide-react";
import { useState } from "react";
import { useServiceWorker } from "@/hooks/useServiceWorker";

export function RegisterServiceWorker() {
  const serviceWorker = useServiceWorker();
  const [dismissed, setDismissed] = useState(false);

  if (!serviceWorker.updateReady || dismissed) return null;

  return (
    <div className="toast-safe-bottom fixed left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-md border border-border bg-panel p-3 shadow-panel">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium text-foreground">Update ready</div>
          <div className="text-muted-foreground">Reload to use the latest app shell.</div>
        </div>
        <button
          type="button"
          onClick={serviceWorker.activateUpdate}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground focus:focus-ring"
        >
          <RefreshCcw className="h-4 w-4" />
          Reload
        </button>
        <button
          type="button"
          aria-label="Dismiss update"
          title="Dismiss update"
          onClick={() => setDismissed(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:focus-ring"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
