import { cp, rename, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const outDir = join(root, "out");
const distDir = join(root, "dist");
const nextDevDir = join(root, ".next", "dev");
const apiDir = join(root, "app", "api");
const disabledApiDir = join(root, ".api-disabled-for-static-export");

let apiDisabled = false;
let exitCode = 0;

try {
  await rm(disabledApiDir, { recursive: true, force: true });
  await rm(nextDevDir, { recursive: true, force: true });
  if (await exists(apiDir)) {
    try {
      await rename(apiDir, disabledApiDir);
    } catch (error) {
      if (isPermissionError(error)) {
        console.error(
          [
            "Could not prepare the static export because app/api is locked.",
            "Stop any running npm run dev or npm run dev:standalone server, then run the build again."
          ].join("\n")
        );
      }
      throw error;
    }
    apiDisabled = true;
  }

  const result = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: root,
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    exitCode = result.status ?? 1;
  } else {
    await rm(distDir, { recursive: true, force: true });
    await cp(outDir, distDir, { recursive: true });
    await rm(outDir, { recursive: true, force: true });

    for (const required of ["index.html", "manifest.webmanifest", "sw.js"]) {
      await stat(join(distDir, required));
    }
  }
} finally {
  if (apiDisabled) {
    await rename(disabledApiDir, apiDir);
  }
}

if (exitCode !== 0) {
  process.exit(exitCode);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isPermissionError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
}

console.log("Static Next.js export copied to dist/");
