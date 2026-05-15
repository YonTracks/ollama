# Ollama App UI

This directory contains the static Next.js App Router UI embedded by the desktop app.

## Development

- `npm run dev` starts the Next.js dev server on `http://localhost:5173`.
- In development, browser API calls default to `http://127.0.0.1:3001`.
- Set `NEXT_PUBLIC_OLLAMA_API_BASE` to point the UI at a different local app server.
- `http://localhost:5173` is the UI shell only; the full desktop UI still needs the app backend APIs on `http://127.0.0.1:3001`.

### `ollama serve` only

`ollama serve` usually runs the core model API on `http://127.0.0.1:11434`.
Use standalone mode to run the browser UI without the desktop app backend:

- `npm run dev:standalone` starts Next.js on `http://localhost:5173` with the UI pointed at `http://127.0.0.1:11434`.
- `npm run build:standalone` exports a standalone static build.
- `NEXT_PUBLIC_OLLAMA_CORE_API_BASE` can point standalone mode at another local Ollama server.
- `http://localhost:5173?mode=standalone` persists standalone mode for that browser profile.

Standalone mode uses `/api/version`, `/api/tags`, and `/api/chat`, stores chats
in IndexedDB, stores standalone settings in local storage, and avoids `/api/v1/*`.
Desktop-app-only settings are hidden in this mode.

## Build

- `npm run build` runs `next build` with `output: "export"`.
- `npm run build:standalone` does the same with `NEXT_PUBLIC_OLLAMA_UI_MODE=standalone`.
- The static export is copied into `dist/` because `app/ui/app.go` embeds `app/dist`.
- `npm run start` serves the generated `dist/` folder for a local production smoke test.
- The static smoke server proxies `/api/*` to `OLLAMA_APP_API_BASE`, defaulting to `http://127.0.0.1:3001`.
- The desktop tray/taskbar settings action opens `/settings`, which is exported as `dist/settings/index.html`.

## PWA

- `public/manifest.webmanifest` defines the installable app metadata.
- `public/sw.js` caches only the static app shell and same-origin static assets.
- Ollama API routes under `/api/` are intentionally excluded from service-worker caching.
- Chat prompts, chat responses, API responses, and model metadata are not cached by the service worker.
