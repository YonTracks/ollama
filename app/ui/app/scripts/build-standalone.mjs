process.env.NEXT_PUBLIC_OLLAMA_UI_MODE = "standalone";
process.env.NEXT_PUBLIC_OLLAMA_CORE_API_BASE =
  process.env.NEXT_PUBLIC_OLLAMA_CORE_API_BASE || "http://127.0.0.1:11434";

await import("./build-static.mjs");
