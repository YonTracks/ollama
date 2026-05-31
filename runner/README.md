# `runner`

This package is the internal dispatch point for non-GGUF auxiliary engines.
It currently accepts:

- `--imagegen-engine`
- `--mlx-engine`

GGUF/GGML text and embedding inference no longer runs through a Go-side
classic runner from this directory. The scheduler launches `llama-server`
instead, and Ollama talks to that subprocess over HTTP. Runner selection,
backend library paths, llama-server flags, and startup logs live in:

- `server/sched.go`
- `llm/llama_server.go`
- `discover/llama_server.go`
- `discover/runner.go`

Do not re-add `llamarunner`, `ollamarunner`, or force-classic runner logic here.
See `docs/custom-runner-notes.md` for the compatibility notes used by the
YonTracks branches.
