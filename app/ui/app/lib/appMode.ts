export type AppMode = "desktop" | "standalone";

function parseMode(value: string | null | undefined): AppMode | null {
  if (value === "desktop" || value === "standalone") return value;
  return null;
}

export function getDefaultAppMode(): AppMode {
  return parseMode(process.env.NEXT_PUBLIC_OLLAMA_UI_MODE) ?? "desktop";
}

export function readBrowserAppMode(): AppMode {
  if (typeof window === "undefined") return getDefaultAppMode();

  if (isDesktopShell()) {
    return "desktop";
  }

  const configuredMode = parseMode(process.env.NEXT_PUBLIC_OLLAMA_UI_MODE);
  if (configuredMode) {
    return configuredMode;
  }

  return "desktop";
}

function isDesktopShell() {
  return Boolean(window.OLLAMA_DESKTOP || window.ready || window.webview);
}
