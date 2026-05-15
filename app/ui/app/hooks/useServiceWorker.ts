"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ServiceWorkerState } from "@/types/app";

const initialState: ServiceWorkerState = {
  supported: false,
  registered: false,
  installing: false,
  updateReady: false,
  error: null
};

export function useServiceWorker() {
  const [state, setState] = useState<ServiceWorkerState>(initialState);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setState((current) => ({ ...current, supported: false }));
      return;
    }

    let mounted = true;

    const register = async () => {
      setState((current) => ({ ...current, supported: true, installing: true }));

      try {
        const nextRegistration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/"
        });

        if (!mounted) return;
        setRegistration(nextRegistration);
        setState({
          supported: true,
          registered: true,
          installing: false,
          updateReady: Boolean(nextRegistration.waiting),
          error: null
        });

        nextRegistration.addEventListener("updatefound", () => {
          const installing = nextRegistration.installing;
          if (!installing) return;

          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setState((current) => ({ ...current, updateReady: true }));
            }
          });
        });
      } catch (error) {
        if (!mounted) return;
        setState({
          supported: true,
          registered: false,
          installing: false,
          updateReady: false,
          error: error instanceof Error ? error.message : "Service worker registration failed"
        });
      }
    };

    register();

    return () => {
      mounted = false;
    };
  }, []);

  const activateUpdate = useCallback(() => {
    if (!registration?.waiting) return;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    window.location.reload();
  }, [registration]);

  return useMemo(
    () => ({
      ...state,
      activateUpdate
    }),
    [activateUpdate, state]
  );
}
