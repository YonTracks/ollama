import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const hostname = process.env.HOST || "localhost";
const port = process.env.PORT || "5173";

const child = spawn(process.execPath, [nextBin, "dev", "--hostname", hostname, "--port", port], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_OLLAMA_UI_MODE: "standalone",
    NEXT_PUBLIC_OLLAMA_CORE_API_BASE:
      process.env.NEXT_PUBLIC_OLLAMA_CORE_API_BASE || "http://127.0.0.1:11434"
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
