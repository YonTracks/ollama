import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, "dist");
const resolvedDistDir = resolve(distDir);
const port = Number(process.env.PORT || 3000);
const apiBase = (process.env.OLLAMA_APP_API_BASE || "http://127.0.0.1:3001").replace(/\/$/, "");
const apiBaseUrl = new URL(apiBase);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"]
]);

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const cleanPath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const target = resolve(join(distDir, cleanPath));
  const relativeTarget = relative(resolvedDistDir, target);
  if (relativeTarget.startsWith("..") || relativeTarget === "" || relativeTarget.includes("..\\")) {
    return join(resolvedDistDir, "index.html");
  }
  return pathname.endsWith("/") ? join(target, "index.html") : target;
}

function isApiRequest(url) {
  return new URL(url, "http://localhost").pathname.startsWith("/api/");
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function proxyApi(req, res) {
  const target = new URL(req.url, apiBaseUrl);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readRequestBody(req);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];
  if (!isLoopbackHost(target.hostname)) {
    delete headers.cookie;
    delete headers.authorization;
  }

  try {
    const response = await fetch(target, {
      method: req.method,
      headers,
      body
    });

    const responseHeaders = Object.fromEntries(response.headers.entries());
    if (!isLoopbackHost(target.hostname)) {
      delete responseHeaders["set-cookie"];
    }
    res.writeHead(response.status, responseHeaders);
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: `Unable to proxy API request to ${apiBase}`,
        details: error instanceof Error ? error.message : "Unknown proxy error"
      })
    );
  }
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

async function sendFile(res, filePath) {
  const file = await stat(filePath);
  if (file.isDirectory()) {
    return sendFile(res, join(filePath, "index.html"));
  }

  res.writeHead(200, {
    "Content-Length": file.size,
    "Content-Type": contentTypes.get(extname(filePath)) || "application/octet-stream"
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  if (isApiRequest(req.url)) {
    await proxyApi(req, res);
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  try {
    await sendFile(res, resolveRequestPath(req.url));
  } catch {
    try {
      await sendFile(res, join(distDir, "index.html"));
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving dist/ at http://127.0.0.1:${port}`);
  console.log(`Proxying /api/* to ${apiBase}`);
});
