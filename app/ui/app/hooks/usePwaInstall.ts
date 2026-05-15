"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { InstallPromptEvent } from "@/types/app";

type InstallEnvironment = "browser" | "ios" | "desktop-shell";

export function usePwaInstall() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [environment, setEnvironment] = useState<InstallEnvironment>("browser");

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const isDesktopShell = Boolean(window.OLLAMA_DESKTOP || window.ready || window.webview);
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      nav.standalone === true;

    setEnvironment(isDesktopShell ? "desktop-shell" : isIos ? "ios" : "browser");
    setInstalled(standalone);

    const handleBeforeInstallPrompt = (event: Event) => {
      if (isDesktopShell) return;
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };

    const handleInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;

    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }, [prompt]);

  return useMemo(
    () => ({
      canInstall: Boolean(prompt),
      environment,
      installed,
      install
    }),
    [environment, install, installed, prompt]
  );
}
