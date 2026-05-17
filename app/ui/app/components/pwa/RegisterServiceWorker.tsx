"use client";

import { useEffect, useState } from "react";
import { useServiceWorker } from "@/hooks/useServiceWorker";
import { useToast } from "@/components/ui/ToastProvider";

export function RegisterServiceWorker() {
  const serviceWorker = useServiceWorker();
  const { showToast } = useToast();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!serviceWorker.updateReady || dismissed) return;

    showToast({
      id: "service-worker-update",
      title: "Update ready",
      description: "Reload to use the latest app shell.",
      tone: "info",
      duration: false,
      action: {
        label: "Reload",
        onClick: serviceWorker.activateUpdate
      },
      onDismiss: () => setDismissed(true)
    });
  }, [
    dismissed,
    serviceWorker.activateUpdate,
    serviceWorker.updateReady,
    showToast
  ]);

  useEffect(() => {
    if (!serviceWorker.error) return;

    showToast({
      id: "service-worker-error",
      title: "Offline app cache unavailable",
      description: serviceWorker.error,
      tone: "danger",
      duration: 7000
    });
  }, [serviceWorker.error, showToast]);

  return null;
}
