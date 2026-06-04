import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const outDir = join(root, "out");
const distDir = join(root, "dist");
const nextDevDir = join(root, ".next", "dev");
const apiDir = join(root, "app", "api");
const disabledApiDir = join(root, ".api-disabled-for-static-export");
const buildLockDir = join(root, ".static-export.lock");

class BuildLockError extends Error {
  constructor(message) {
    super(message);
    this.name = "BuildLockError";
  }
}

let apiDisabled = false;
let lockAcquired = false;
let exitCode = 0;
let fatalError;

try {
  await acquireBuildLock();
  lockAcquired = true;

  await recoverInterruptedStaticExport();
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
    await writeServiceWorkerPrecacheManifest();

    for (const required of ["index.html", "manifest.webmanifest", "sw.js"]) {
      await stat(join(distDir, required));
    }
  }
} catch (error) {
  if (error instanceof BuildLockError) {
    console.error(error.message);
    exitCode = 1;
  } else {
    fatalError = error;
  }
} finally {
  if (apiDisabled) {
    await rename(disabledApiDir, apiDir);
  }
  if (lockAcquired) {
    await rm(buildLockDir, { recursive: true, force: true });
  }
}

if (fatalError) {
  throw fatalError;
}

if (exitCode !== 0) {
  process.exit(exitCode);
}

async function acquireBuildLock() {
  try {
    await mkdir(buildLockDir);
  } catch (error) {
    if (hasCode(error, "EEXIST")) {
      throw new BuildLockError(
        [
          "Another static export or standalone build appears to be running.",
          `Lock directory: ${buildLockDir}`,
          "Wait for it to finish, then run the build again.",
          "If no build is running, remove the stale lock directory and retry."
        ].join("\n")
      );
    }
    throw error;
  }

  await writeFile(
    join(buildLockDir, "owner.json"),
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`
  );
}

async function recoverInterruptedStaticExport() {
  const apiExists = await exists(apiDir);
  const disabledApiExists = await exists(disabledApiDir);

  if (!apiExists && disabledApiExists) {
    await rename(disabledApiDir, apiDir);
    return;
  }

  if (apiExists && disabledApiExists) {
    await rm(disabledApiDir, { recursive: true, force: true });
  }
}

async function writeServiceWorkerPrecacheManifest() {
  const swPath = join(distDir, "sw.js");
  const swSource = await readFile(swPath, "utf8");
  const placeholder = "const PRECACHE_ASSETS = [];";
  if (!swSource.includes(placeholder)) {
    throw new Error("Could not find service worker precache placeholder.");
  }

  const assetPaths = [
    ...(await listDistFiles(join(distDir, "_next", "static"))),
    ...(await listDistFiles(distDir, (path) => extname(path) === ".txt"))
  ];
  const urls = [...new Set(assetPaths.map((path) => `/${relative(distDir, path).replaceAll("\\", "/")}`))].sort();
  const manifest = `const PRECACHE_ASSETS = ${JSON.stringify(urls, null, 2)};`;

  await writeFile(swPath, swSource.replace(placeholder, manifest));
}

async function listDistFiles(dir, include = () => true) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listDistFiles(entryPath, include)));
    } else if (entry.isFile() && include(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
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
  return hasCode(error, "EPERM");
}

function hasCode(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

console.log("Static Next.js export copied to dist/");
