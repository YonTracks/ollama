# Ollama for macOS and Windows

## Download

- [macOS](https://github.com/ollama/app/releases/download/latest/Ollama.dmg)
- [Windows](https://github.com/ollama/app/releases/download/latest/OllamaSetup.exe)

## Development

### Desktop App

```bash
go generate ./... &&
go run ./cmd/app
```

### UI Development

#### Setup

Install required tools:

```bash
go install github.com/tkrajina/typescriptify-golang-structs/tscriptify@latest
```

Use Go 1.26.3 or newer when building the app. Earlier Go 1.26 patch releases include standard-library vulnerabilities reported by `govulncheck`.

#### Develop UI (Development Mode)

1. Start the Next.js development server (with hot-reload):

```bash
cd ui/app
npm install
npm run dev
```

2. In a separate terminal, run the Ollama app with the `-dev` flag:

```bash
go generate ./... &&
OLLAMA_DEBUG=1 go run ./cmd/app -dev
```

The `-dev` flag enables:

- Loading the UI from the Next.js dev server at http://localhost:5173
- Fixed UI server port at http://127.0.0.1:3001 for API requests
- CORS headers for cross-origin requests
- Hot-reload support for UI development

#### Desktop tool development

Desktop Agent / Tools settings are hidden by default. To expose read-only local tools during development, launch the desktop app with:

```bash
OLLAMA_DESKTOP_TOOLS=1 go run ./cmd/app -dev
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
