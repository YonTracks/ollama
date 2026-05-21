import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldRegisterServiceWorker } from "./useServiceWorker";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shouldRegisterServiceWorker", () => {
  it("does not register without a browser window", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldRegisterServiceWorker(undefined)).toBe(false);
  });

  it("does not register during development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(shouldRegisterServiceWorker({})).toBe(false);
  });

  it("does not register inside the desktop shell", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldRegisterServiceWorker({ OLLAMA_DESKTOP: true })).toBe(false);
    expect(shouldRegisterServiceWorker({ ready: () => undefined })).toBe(false);
    expect(shouldRegisterServiceWorker({ webview: {} })).toBe(false);
  });

  it("registers for production browser/PWA builds", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldRegisterServiceWorker({})).toBe(true);
  });
});
