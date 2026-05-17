"use client";

import { CheckCircle2, Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";

export function InstallButton() {
  const install = usePwaInstall();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!helpOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelpOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [helpOpen]);

  if (install.environment === "desktop-shell") {
    return null;
  }

  if (install.installed) {
    return (
      <IconButton label="Installed" disabled>
        <CheckCircle2 className="h-5 w-5 text-success" />
      </IconButton>
    );
  }

  return (
    <>
      <IconButton
        label={install.canInstall ? "Install app" : "Install help"}
        onClick={() => {
          if (install.canInstall) {
            install.install();
            return;
          }

          setHelpOpen(true);
        }}
      >
        <Download className="h-5 w-5" />
      </IconButton>

      {helpOpen ? (
        <InstallHelpModal
          environment={install.environment}
          onClose={() => setHelpOpen(false)}
        />
      ) : null}
    </>
  );
}

function InstallHelpModal({
  environment,
  onClose
}: {
  environment: "browser" | "ios";
  onClose(): void;
}) {
  const steps =
    environment === "ios"
      ? ["Open the Share menu.", "Choose Add to Home Screen.", "Confirm the name and add it."]
      : [
          "Use the install icon in the browser address bar when it appears.",
          "Or open the browser menu and choose Install app.",
          "Reload once after the first visit if the install action is not visible."
        ];

  return (
    <div className="modal-safe-padding fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label="Close install help"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-help-title"
        className={cn(
          "relative z-10 w-full max-w-sm rounded-lg border border-border bg-panel p-4 shadow-panel"
        )}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-panel-strong text-accent">
            <Download className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="install-help-title" className="text-base font-semibold">
              Install Ollama
            </h2>
            <p className="text-sm text-muted-foreground">Browser install prompt is not ready.</p>
          </div>
          <IconButton label="Close install help" onClick={onClose}>
            <X className="h-5 w-5" />
          </IconButton>
        </div>

        <ol className="space-y-2 text-sm text-muted-foreground">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-border bg-panel-strong text-xs text-foreground">
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
