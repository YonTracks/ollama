process.env.HOST = process.env.HOST || "localhost";
process.env.PORT = process.env.PORT || "5173";
process.env.OLLAMA_APP_API_BASE = process.env.OLLAMA_APP_API_BASE || "http://127.0.0.1:11434";

await import("./serve-dist.mjs");
