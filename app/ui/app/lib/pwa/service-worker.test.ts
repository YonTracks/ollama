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

    expect(source).toContain('"/admin/"');
    expect(source).toContain('"/settings/"');
    expect(source).toContain('"/favicon.svg"');
    expect(source).toContain("cache.put(request, copy)");
    expect(source).toContain('caches.match("/")');
    expect(source).not.toContain('cache.put("/", copy)');
  });

  it("does not cache token-bearing or query-string navigations", () => {
    const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

    expect(source).toContain('"ollama_token"');
    expect(source).toContain("SENSITIVE_CACHE_QUERY_PARAMS.some");
    expect(source).toContain('request.mode === "navigate" && url.search');
  });

  it("uses a new cache version for app shell updates", () => {
    const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

    expect(source).toContain('const CACHE_VERSION = "ollama-app-shell-v10"');
  });

  it("installs the app shell, generated assets, and removes older cache versions on activation", () => {
    const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

    expect(source).toContain("const PRECACHE_ASSETS = []");
    expect(source).toContain("cache.addAll([...new Set([...APP_SHELL, ...PRECACHE_ASSETS])])");
    expect(source).toContain('url.pathname.startsWith("/_next/static/")');
    expect(source).toContain('url.pathname.endsWith(".txt")');
    expect(source).toContain("self.skipWaiting()");
    expect(source).toContain("keys.filter((key) => !key.startsWith(CACHE_VERSION))");
    expect(source).toContain("caches.delete(key)");
    expect(source).toContain("self.clients.claim()");
  });

  it("falls back to the offline app shell when navigation requests miss cache", () => {
    const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

    expect(source).toContain("fetch(request)");
    expect(source).toContain("caches.match(request)");
    expect(source).toContain('caches.match("/")');
    expect(source).toContain('caches.match("/offline/")');
  });

  it("registers service worker updates without stale browser cache", () => {
    const source = readFileSync(join(process.cwd(), "hooks", "useServiceWorker.ts"), "utf8");

    expect(source).toContain('updateViaCache: "none"');
    expect(source).toContain('"controllerchange"');
    expect(source).toContain("nextRegistration.update()");
  });
});
