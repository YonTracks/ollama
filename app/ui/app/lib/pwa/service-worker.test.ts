import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("service worker cache policy", () => {
  it("explicitly excludes Ollama API and chat requests from caching", () => {
    const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

    expect(source).toContain('"/api/chat"');
    expect(source).toContain('"/api/generate"');
    expect(source).toContain('"/api/tags"');
    expect(source).toContain('"/api/show"');
    expect(source).toContain('"/api/search"');
    expect(source).toContain("RUNTIME_CACHE_EXCLUDED_PATHS.some");
    expect(source).toContain("if (isApiRequest(url)) return false");
    expect(source).toContain("request.method !== \"GET\"");
  });

  it("caches navigations by request URL so offline routes keep their own shell", () => {
    const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

    expect(source).toContain('"/favicon.svg"');
    expect(source).toContain("cache.put(request, copy)");
    expect(source).toContain('caches.match("/")');
    expect(source).not.toContain('cache.put("/", copy)');
  });

  it("uses a new cache version for app shell updates", () => {
    const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

    expect(source).toContain('const CACHE_VERSION = "ollama-app-shell-v6"');
  });

  it("registers service worker updates without stale browser cache", () => {
    const source = readFileSync(join(process.cwd(), "hooks", "useServiceWorker.ts"), "utf8");

    expect(source).toContain('updateViaCache: "none"');
    expect(source).toContain('"controllerchange"');
    expect(source).toContain("nextRegistration.update()");
  });
});
