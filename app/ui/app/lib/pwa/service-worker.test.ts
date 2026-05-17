import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("service worker cache policy", () => {
  it("explicitly excludes Ollama API and chat requests from caching", () => {
    const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

    expect(source).toContain('url.pathname.startsWith("/api/")');
    expect(source).toContain("if (isApiRequest(url)) return false");
    expect(source).toContain("request.method !== \"GET\"");
  });

  it("caches navigations by request URL so offline routes keep their own shell", () => {
    const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

    expect(source).toContain('"/favicon.svg"');
    expect(source).toContain("cache.put(request, copy)");
    expect(source).not.toContain('cache.put("/", copy)');
  });
});
