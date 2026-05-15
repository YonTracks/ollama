import { afterEach, describe, expect, it, vi } from "vitest";
import { readBrowserAppMode } from "./appMode";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_OLLAMA_UI_MODE;
});

describe("app mode detection", () => {
  it("uses explicit standalone query mode in browsers", () => {
    const storage = stubWindow("http://localhost:5173/?mode=standalone");

    expect(readBrowserAppMode()).toBe("standalone");
    expect(storage.get("ollama.app.mode.v1")).toBe("standalone");
  });

  it("forces desktop mode inside the native shell even if standalone was stored", () => {
    const storage = stubWindow("http://127.0.0.1:3001/", "standalone", true);

    expect(readBrowserAppMode()).toBe("desktop");
    expect(storage.get("ollama.app.mode.v1")).toBe("desktop");
  });
});

function stubWindow(href: string, storedMode?: string, desktop = false) {
  const storage = new Map<string, string>();
  if (storedMode) {
    storage.set("ollama.app.mode.v1", storedMode);
  }

  vi.stubGlobal("window", {
    location: { href },
    OLLAMA_DESKTOP: desktop,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      }
    }
  });

  return storage;
}
