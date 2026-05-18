export type AppMode = "desktop" | "standalone";

const MODE_STORAGE_KEY = "ollama.app.mode.v1";

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
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, "desktop");
    } catch {
      // Desktop mode still applies for this session.
    }
    return "desktop";
  }

  const url = new URL(window.location.href);
  const queryMode = parseMode(url.searchParams.get("mode"));
  if (queryMode) {
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, queryMode);
    } catch {
      // Mode still applies for this session.
    }
    return queryMode;
  }

  const configuredMode = parseMode(process.env.NEXT_PUBLIC_OLLAMA_UI_MODE);
  if (configuredMode) {
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, configuredMode);
    } catch {
      // Mode still applies for this session.
    }
    return configuredMode;
  }

  try {
    return parseMode(window.localStorage.getItem(MODE_STORAGE_KEY)) ?? "desktop";
  } catch {
    return "desktop";
  }
}

function isDesktopShell() {
  return Boolean(window.OLLAMA_DESKTOP || window.ready || window.webview);
}

export function writeBrowserAppMode(mode: AppMode) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // The in-memory React state still updates.
  }
}
