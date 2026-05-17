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

## Context features

- Friendly context mode trims, summarizes, and retrieves relevant older turns before requests are sent.
- Auto-summarize old messages and Retrieval memory are enabled by default for new and reset local settings.
- Retrieval memory defaults to the active conversation and is injected as request-only system context.
- Desktop retrieval memory uses a cached SQLite vector store when an embedding model is available, and falls back to lexical retrieval when embeddings fail or are disabled.
- Desktop users can opt into a Selected memory scope for chosen saved chats plus the current chat, or an All chats scope for every saved chat in SQLite.
- Cross-chat snippets are local and source-labeled.
- Desktop users can mark saved chats as Excluded from memory; those chats are blocked from cross-chat retrieval even when All chats is selected.
- Retrieval ranking combines semantic similarity, explicit memory-intent boosts such as remembered names, and a small recency boost.
- Standalone browser mode keeps retrieval memory scoped to the current chat.
- The desktop embedding model defaults to `nomic-embed-text`; set `OLLAMA_RAG_EMBED_MODEL` to another local embedding model, or `off` to force lexical retrieval.
- Expert chat mode adds request-only expert instructions; the Models panel can apply an expert template when creating a derived Ollama model.

## Desktop tools

- Desktop agent/tool controls are hidden unless the desktop shell injects `window.OLLAMA_TOOLS = true`.
- The shell only injects that flag when `OLLAMA_DESKTOP_TOOLS=1` or `OLLAMA_DESKTOP_TOOLS=true` is set and the app backend has registered local tools.
- The environment gate enables the UI surface; users then choose exactly one desktop tool access mode: Off, Tools, or Agent.
- Registered desktop tools are read-only: `desktop.list_files`, `desktop.read_text_file`, and `desktop.search_files`.
- Desktop tools are scoped to the configured working directory. Paths outside that directory, including symlink escapes, are rejected.
- File reads and searches are bounded; hidden files and common generated/dependency folders are skipped by default.
- Tools mode exposes registered tools for one tool-use pass, then asks the model to answer from the result. Agent mode keeps tools available for multiple passes, capped by the backend.
- Standalone mode never exposes desktop tools because it talks directly to the core Ollama API.

## Build

- `npm run build` runs `next build` with `output: "export"`.
- `npm run build:standalone` does the same with `NEXT_PUBLIC_OLLAMA_UI_MODE=standalone`.
- The static export is copied into `dist/` because `app/ui/app.go` embeds `app/dist`.
- `npm run start` serves the generated `dist/` folder for a local production smoke test.
- The static smoke server proxies `/api/*` to `OLLAMA_APP_API_BASE`, defaulting to `http://127.0.0.1:3001`.
- The desktop tray/taskbar settings action opens `/settings`, which is exported as `dist/settings/index.html`.

## PWA

- `public/manifest.webmanifest` defines the installable app metadata.
- `public/sw.js` pre-caches the static app shell routes and same-origin static assets.
- Navigation responses are cached by request URL so exported routes such as `/`, `/settings/`, and `/offline/` keep distinct offline shells.
- Ollama API routes under `/api/` are intentionally excluded from service-worker caching.
- Chat prompts, chat responses, API responses, and model metadata are not cached by the service worker.
- The shell uses safe-area and titlebar overlay padding for installed PWA surfaces.
- The sidebar is open by default on desktop-sized viewports and starts off-canvas on mobile until the user opens it.
