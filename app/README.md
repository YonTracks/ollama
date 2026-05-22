# Ollama for macOS and Windows

## Download

- [macOS](https://github.com/ollama/app/releases/download/latest/Ollama.dmg)
- [Windows](https://github.com/ollama/app/releases/download/latest/OllamaSetup.exe)

## Development

### Desktop App

```bash
go generate ./... &&
go run ./app/cmd/app
```

### UI Development

#### Setup

Install required tools:

```bash
go install github.com/tkrajina/typescriptify-golang-structs/tscriptify@latest
```

Use Go 1.26.3 or newer when building the app. Earlier Go 1.26 patch releases include standard-library vulnerabilities reported by `govulncheck`.

#### Develop UI (Development Mode)

Quit the installed taskbar app (if running) before launching `go run ./app/cmd/app -dev` or `ollama serve` so
the existing-instance guard does not focus the packaged app instead of your dev
process.

1. Start the core Ollama API:

```bash
ollama serve
```

For more server detail, use `OLLAMA_DEBUG=1 ollama serve` for DEBUG logs or
`OLLAMA_DEBUG=2 ollama serve` for TRACE logs. TRACE is more verbose and is most
useful when diagnosing parser/tool/model-runner behavior.

2. In a second terminal, from the repository root, start the Next.js development server (with hot-reload):

```bash
cd app/ui/app
npm install # only needed once
npm run dev
```

3. In a third terminal, from the repository root, run the Ollama app with the `-dev` flag:

```bash
OLLAMA_DEBUG=1 go run ./app/cmd/app -dev
```

Use `OLLAMA_DEBUG=1` for desktop app shell debug logs and WebView dev behavior.
`OLLAMA_DEBUG=2` is the TRACE level for the core Ollama API and model runners,
so put it on the `ollama serve` process when you need the extra detail.

The `-dev` flag enables:

- Loading the UI from the Next.js dev server at http://localhost:5173
- Fixed UI server port at http://127.0.0.1:3001 for API requests
- CORS headers for cross-origin requests
- Hot-reload support for UI development

Keep these as three separate processes while developing: `ollama serve`, the
Next.js dev server, and the desktop app shell.

Logs are split by process during development:

- `ollama serve` prints live core server logs in terminal 1.
- `npm run dev` prints Next.js UI logs in terminal 2.
- `go run ./app/cmd/app -dev` prints desktop app shell logs in terminal 3.

Debug levels for the core Ollama API are `OLLAMA_DEBUG=1` for DEBUG and
`OLLAMA_DEBUG=2` for TRACE. Use TRACE sparingly because it is much noisier and
can include parser, tool, and runner detail that is not normally needed.

When using the installed taskbar app instead of manual terminals, view logs in
`%LOCALAPPDATA%\Ollama` on Windows or `~/.ollama/logs` on macOS. `app.log`
contains GUI app logs, `server.log` contains core server logs, and rotated logs
use suffixes such as `app-1.log` and `server-1.log`.

For desktop hot-reload, use `npm run dev`, not `npm run dev:standalone`.
Standalone mode is a separate browser/PWA entrypoint that talks directly to the
core Ollama API and stores chats in browser IndexedDB.
For standalone browser testing, the core API can come from `ollama serve` or
from the installed Ollama taskbar app if it is already serving
`http://127.0.0.1:11434`. Use one core API source at a time, not both.
Standalone still does not use the desktop app backend for chats, settings, or
tools.

The Windows installer writes `OLLAMA_HOST=127.0.0.1:11434` only when the user
does not already have `OLLAMA_HOST` configured. The installer runs without
elevation and does not add firewall rules, so use Windows Firewall or endpoint
management policy to block inbound `11434` when you need an explicit rule.

For explicit core API authentication during local or LAN testing, set
`OLLAMA_API_TOKEN` on both `ollama serve` and the Ollama CLI processes. Requests
must include `Authorization: Bearer <token>`. The desktop app proxy remains
separate and keeps its own session token.

The standalone browser/PWA keeps `OLLAMA_API_TOKEN` in memory by default.
Settings can remember it in the browser profile for automatic reconnect, or
lock it with passphrase-encrypted Web Crypto material when you prefer to unlock
it manually after restart. The token is never written to the standalone settings
JSON.
Standalone browser chats are normal IndexedDB records by default; Settings ->
Storage can enable passphrase-based browser chat encryption, which rewrites
existing standalone chats and keeps future saves encrypted while unlocked.

For desktop app privacy at rest, set `OLLAMA_APP_DATA_KEY` before launching the
taskbar app or `go run ./app/cmd/app -dev`. When present, new sensitive SQLite
fields such as chat titles, message content, tool results, attachments, browser
state, and cached user profile data are encrypted with AES-GCM. Existing
plaintext rows remain readable so users can upgrade without a migration step;
keep the same key available or encrypted rows cannot be read.
To turn desktop SQLite encryption off, launch once with the same
`OLLAMA_APP_DATA_KEY` and `OLLAMA_APP_DATA_ENCRYPTION=off`. Startup rewrites the
encrypted sensitive fields back to plaintext. After that succeeds, remove both
environment variables.

If you use `CUSTOM_SEARCH_ENDPOINT`, it must be an HTTP(S) endpoint on a public
host by default. Local/private custom search adapters require
`CUSTOM_SEARCH_ALLOW_LOCAL=true` so SSRF-sensitive routing stays opt-in.

Run `go generate ./...` from the repository root only when you need to refresh
generated TypeScript or embedded static UI assets. Stop any running
`npm run dev` or `npm run dev:standalone` server first; on Windows, Next.js can
hold `app/ui/app/app/api` open and block the static export step.

#### Desktop tool development

Desktop Agent / Tools settings are hidden by default. To expose read-only local tools during development, launch the desktop app with:

```bash
OLLAMA_DESKTOP_TOOLS=1 go run ./app/cmd/app -dev
```

The registered desktop tools are `desktop.list_files`, `desktop.read_text_file`, and `desktop.search_files`. They are scoped to the working directory selected in settings, reject path escapes, and skip hidden files plus common generated/dependency folders by default.

Hidden files and generated/dependency folders remain blocked even if a model requests them. To allow that access for a trusted development chat, set `OLLAMA_DESKTOP_TOOLS_SENSITIVE=1` before launching the app.

#### Vector retrieval memory

Desktop Retrieval memory stores local message embeddings in SQLite for semantic recall. The default embedding model is `nomic-embed-text`:

```bash
ollama pull nomic-embed-text
```

Set `OLLAMA_RAG_EMBED_MODEL` to use another local embedding model, or set it to `off` to force lexical retrieval. If embedding is unavailable, the app falls back to lexical retrieval automatically.

Retrieval scope defaults to `Current chat`. Desktop settings can opt into `Selected`,
which searches chosen saved chats plus the current chat, or `All chats`, which
searches locally saved chats in the same SQLite store. Cross-chat snippets are
prefixed with their source chat title. Standalone browser mode remains current-chat
only. Chats marked `Excluded from memory` are blocked from cross-chat retrieval,
even in `All chats` scope; the active chat is still included when you are using
that chat directly. Retrieval ranking combines semantic similarity, explicit
memory-intent boosts, and a small recency boost.

## Build


### Windows

- https://jrsoftware.org/isinfo.php


**Dependencies** - either build a local copy of ollama, or use a github release
```powershell
# Local dependencies
.\scripts\deps_local.ps1

# Release dependencies
.\scripts\deps_release.ps1 0.6.8
```

**Build**
```powershell
.\scripts\build_windows.ps1
```

### macOS

CI builds with Xcode 14.1 for OS compatibility prior to v13.  If you want to manually build v11+ support, you can download the older Xcode [here](https://developer.apple.com/services-account/download?path=/Developer_Tools/Xcode_14.1/Xcode_14.1.xip), extract, then `mv ./Xcode.app /Applications/Xcode_14.1.0.app` then activate with:

```
export CGO_CFLAGS="-O3 -mmacosx-version-min=12.0"
export CGO_CXXFLAGS="-O3 -mmacosx-version-min=12.0"
export CGO_LDFLAGS="-mmacosx-version-min=12.0"
export SDKROOT=/Applications/Xcode_14.1.0.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk
export DEVELOPER_DIR=/Applications/Xcode_14.1.0.app/Contents/Developer
```

**Dependencies** - either build a local copy of Ollama, or use a GitHub release:
```sh
# Local dependencies
./scripts/deps_local.sh

# Release dependencies
./scripts/deps_release.sh 0.6.8
```

**Build**
```sh
./scripts/build_darwin.sh
```
