import { cp, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const outDir = join(root, "out");
const distDir = join(root, "dist");

const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: root,
  stdio: "inherit",
  env: process.env
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

await rm(distDir, { recursive: true, force: true });
await cp(outDir, distDir, { recursive: true });
await rm(outDir, { recursive: true, force: true });

for (const required of ["index.html", "manifest.webmanifest", "sw.js"]) {
  await stat(join(distDir, required));
}

console.log("Static Next.js export copied to dist/");
