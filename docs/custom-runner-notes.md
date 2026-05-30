# Custom runner compatibility notes

This note is for reviewing custom runner work against the current upstream
architecture. It is intentionally conservative: do not port old patches unless
they still make sense in the llama-server flow.

## Current GGUF runner architecture

- GGUF/GGML model requests are scheduled in `server/sched.go`.
- The scheduler decodes GGUF metadata with `llm.LoadModel`, estimates memory
  with `llm.PredictServerVRAM`, chooses a GPU placement, resolves automatic
  `num_ctx`, `num_batch`, `use_mmap`, and context-shift policy, then creates a
  `llm.LlamaServer` with `llm.NewLlamaServer`.
- `llm.NewLlamaServer` always creates a `llamaServerRunner`; GGUF inference is
  served by the upstream `llama-server` subprocess over HTTP.
- `llm/llama_server.go` owns the subprocess lifecycle, HTTP adapters,
  llama-server CLI flags, filtered environment logging, startup health polling,
  memory/offload log parsing, and runner shutdown.
- `runner/runner.go` no longer dispatches a GGUF runner. Its command path is
  only for the image generation engine and the MLX engine.
- Device discovery also uses llama-server. `discover/llama_server.go` starts
  llama-server without a model and parses `--list-devices` and startup output;
  `discover/runner.go` coordinates backend discovery and fallback behavior.

## What replaced the old CGO/classic runner path

Upstream commit `9db4bdbad` removed the CGO GGUF engines and uses
`llama-server` exclusively for GGML models. The replacement surface is:

- Build and package upstream llama.cpp's `llama-server` and `llama-quantize`.
- Locate the runtime binary with `llm/llama_binary.go`.
- Launch it from `llm/llama_server.go` with Ollama options translated to
  llama-server flags.
- Talk to it through `/completion`, `/v1/chat/completions`, `/embedding`,
  `/tokenize`, `/detokenize`, `/apply-template`, and `/health`.
- Keep compatibility with existing published Ollama GGUFs through the temporary
  `llama/compat` patch layer linked into the fetched llama.cpp build.

Do not reintroduce a Go-side GGUF loader, the old `llamarunner` /
`ollamarunner` binaries, or a force-classic escape hatch.

## Build, launch, configuration, and logs

- Root build orchestration: `CMakeLists.txt` and `cmake/local.cmake`.
- llama.cpp fetch, patch, targets, and install layout:
  `llama/server/CMakeLists.txt` and `llama/server/CMakePresets.json`.
- Pinned llama.cpp version: `LLAMA_CPP_VERSION`.
- Docker packaging: `Dockerfile` stages named `llama-server-*`.
- Windows packaging: `scripts/build_windows.ps1`.
- Runtime lookup: `llm/llama_binary.go`.
- Runtime launch and configuration: `llm/llama_server.go`:
  `startLlamaServer`, `SetupLlamaServerCommandEnv`,
  `appendLlamaServerLogArgs`, `appendBatchArgs`,
  `appendFlashAttentionArgs`, `appendMainGPUArgs`,
  `appendMMProjArgs`, `appendMTPDraftArgs`, and
  `appendContextShiftArgs`.
- Scheduler placement and automatic option policy: `server/sched.go`.
- llama-server logs are sent through `NewStatusWriter(os.Stderr)` and wrapped
  by `memoryParsingWriter` so startup buffer size and layer offload lines feed
  memory accounting.

## Windows build changes

Windows builds now produce a Go binary plus a native `llama-server.exe`
payload, not old GGUF runner executables.

- CPU/base payload uses the `cpu_windows` CMake preset and installs into
  `dist/windows-<arch>/lib/ollama`.
- GPU backends are built as llama-server backend modules in subdirectories such
  as `cuda_v12`, `cuda_v13`, `rocm_v7_1`, and `vulkan`.
- The llama-server CMake installs Windows CRT/OpenMP or MinGW runtime DLLs
  beside the payload so zip installs do not rely on host-global redistributables.
- CUDA v11 is no longer supported by the Windows build script.
- ROCm v6 is skipped; ROCm v7 is the Windows path.
- Vulkan bundles the system `vulkan-1.dll` from the Windows runtime.
- Windows ARM64 builds only the CPU llama-server payload today; extra
  acceleration libraries are not supported there.
- `CGO_ENABLED=1` still appears in Windows build scripts for the Go/native
  project as a whole. That does not mean the old GGUF CGO runner still exists.
- MLX CUDA 13 is still separate from GGUF inference and is used by the MLX /
  image generation path. For local Windows builds on a single NVIDIA GPU, set
  `OLLAMA_MLX_CUDA_ARCHITECTURES` to that GPU's compute capability, for example
  `86` for an RTX 3060, before running `scripts/build_windows.ps1`. The default
  package build keeps the broad upstream architecture set.
- The MLX CUDA Windows install step needs the cuDNN `bin` directory for runtime
  dependency bundling. The build script accepts `CUDNN_INCLUDE_PATH` and
  `CUDNN_LIBRARY_PATH`, derives `CUDNN_ROOT_DIR` from them, and also detects the
  official `CUDNN/v*/include/13.x`, `lib/13.x/x64`, `bin/13.x/x64` layout.
- If `build/mlx_cuda_v13` was created by an older manual CMake command, remove
  that generated build directory before switching generators or MLX CUDA
  architecture settings.

## Low-VRAM hook points

Low-VRAM work should hook into the scheduler and llama-server launch options,
not into a resurrected runner.

- User-facing request/model options should flow through `api.Options`.
- Placement and default policy belong in `server/sched.go`:
  `selectLlamaServerPlacement`, `availableMemoryForPlacement`,
  `bestSingleGPUFit`, `applyAutomaticGenerationBatch`,
  `applyAutomaticMMapPolicy`, `maybeDisableMmapForHostPressure`,
  `reduceAutoNumCtxForLoadOOM`, and related tests.
- New llama-server command-line behavior belongs in `llm/llama_server.go`.
  Add a typed option to `llamaServerLaunchConfig` and append the corresponding
  llama-server flag in a small helper near the existing `append*Args`
  functions.
- Memory prediction changes belong in `llm.PredictServerVRAM` and
  `fs/ggml/ggml.go`, with tests that compare predicted placement against
  llama-server load behavior.
- Backend-specific discovery should remain in `discover/` and `ml/`, using
  llama-server/native probe output rather than old runner binaries.

## MoE CPU offload

The current wrapper has no MoE-specific CPU offload flag or per-expert device
policy. Existing MoE support found in this tree is about model creation,
quantization, metadata/tensor compatibility, and loading via llama-server.

For inference, Ollama currently exposes coarse placement controls through
llama-server options such as `-ngl`, `--main-gpu`, `--split-mode none`,
`--no-mmap`, `--no-mmproj-offload`, KV cache flags, batch/context sizing, and
flash-attention mode. If upstream llama-server adds or already documents a
stable MoE/expert CPU-offload flag, support should be added by plumbing an
Ollama option into `llm/llama_server.go` and scheduler policy. Do not port old
MoE offload patches that depended on direct Go/CGO tensor loading.

## Old custom patches not to re-apply

- Any restoration of the old CGO/classic GGUF runner.
- `OLLAMA_FORCE_CLASSIC_LLAMA_RUNNER` or equivalent force-classic logic.
- Old `llamarunner` or `ollamarunner` build targets, binaries, or CLI dispatch.
- Old Go-side GGUF inference code paths that bypass llama-server.
- Old Windows build glue that packages runner variants instead of
  `llama-server.exe` plus backend modules.
- Old grammar or schema conversion patches that depended on CGO; structured
  output now goes through llama-server JSON schema or grammar request fields.
- Old backend-selection patches that choose runner binaries. Backend selection
  now selects llama-server library directories and `GGML_BACKEND_PATH`.
- Old low-VRAM or MoE patches that manipulate classic-runner layer ownership
  directly. Recreate the behavior through scheduler policy and upstream
  llama-server flags only.

## Inspected files

- `runner/runner.go`
- `llm/server.go`
- `llm/llama_server.go`
- `llm/llama_binary.go`
- `server/sched.go`
- `discover/llama_server.go`
- `discover/runner.go`
- `ml/device.go`
- `fs/ggml/ggml.go`
- `CMakeLists.txt`
- `cmake/local.cmake`
- `llama/server/CMakeLists.txt`
- `llama/server/CMakePresets.json`
- `llama/compat/README.md`
- `scripts/build_windows.ps1`
- `docs/development.md`
- `Dockerfile`

## Safe next steps for the standalone PWA

- Keep the PWA changes separate from runner compatibility work.
- Re-add the PWA on top of this branch only after the llama-server baseline is
  green.
- Avoid touching `llm/`, `server/sched.go`, `discover/`, `ml/`, or
  `llama/server/` for PWA work unless the UI genuinely needs a backend API.
- Add PWA build/dev documentation near the UI code, not in native runner docs.
- Validate the PWA with its own build and browser checks, then run the normal Go
  and native smoke checks to prove it did not disturb runner packaging.
