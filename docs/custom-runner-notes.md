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
- CUDA discovery marks devices as already init-validated when llama-server
  startup output proves the device compute capability is supported by the
  loaded CUDA backend. That avoids a second `GGML_CUDA_INIT=1` probe on startup.

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
  memory accounting. The parser buffers partial lines because llama-server can
  split memory/offload messages across writes.
- Runner/backend selection is logged from `server/sched.go`, including the
  selected runner, model name, GPU count, `num_gpu`, `num_ctx`, batch size,
  `use_mmap`, and context-shift policy.
- When no runner is active yet, GPU free-memory refresh uses cached discovery
  results instead of paying for an extra cold discovery pass before first load.
- Small discrete-GPU helper runners, such as `nomic-embed-text`, skip the slow
  VRAM-recovery wait on unload when their tracked VRAM is tiny relative to the
  device.

## Windows build changes

Windows builds now produce a Go binary plus a native `llama-server.exe`
payload, not old GGUF runner executables.

- CPU/base payload uses the `cpu_windows` CMake preset and installs into
  `dist/windows-<arch>/lib/ollama`.
- GPU backends are built as llama-server backend modules in subdirectories such
  as `cuda_v12`, `cuda_v13`, `rocm_v7_1`, and `vulkan`.
- The Windows CUDA v13 llama-server preset must include the target GPU compute
  capability. RTX 3060 cards are compute capability 8.6, so `cuda_v13` needs
  `86` or Ollama will skip the backend and fall back to CPU.
- The llama-server CMake installs Windows CRT/OpenMP or MinGW runtime DLLs
  beside the payload so zip installs do not rely on host-global redistributables.
- The Go CLI can also depend on MinGW runtime DLLs through CGO packages. The
  Windows build script bundles those beside `ollama.exe` and dependency-audits
  staged payloads after compression so packaging does not race `dumpbin`.
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
- YonTracks Windows setup builds include the `mlx_*` payload in
  `OllamaSetup.exe`; otherwise installed MLX models fail at runtime with
  `mlxc.dll not found` even when the separate MLX zip is valid.
- The MLX CUDA Windows install step needs the cuDNN `bin` directory for runtime
  dependency bundling. The build script accepts `CUDNN_INCLUDE_PATH` and
  `CUDNN_LIBRARY_PATH`, derives `CUDNN_ROOT_DIR` from them, and also detects the
  official `CUDNN/v*/include/13.x`, `lib/13.x/x64`, `bin/13.x/x64` layout.
- If `build/mlx_cuda_v13` was created by an older manual CMake command, remove
  that generated build directory before switching generators or MLX CUDA
  architecture settings.
- The full Windows packaging script is the normal path for the custom build:
  set `VERSION` and `PKG_VERSION` to the YonTracks version, then run
  `scripts/build_windows.ps1`. A manual
  `cmake -B build\mlx_cuda_v13 . -DOLLAMA_MLX_BACKENDS=cuda_v13` build is only
  useful for isolated MLX development and does not replace the installer/zip
  packaging flow.

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

The current wrapper has no custom MoE-specific CPU offload flag or per-expert
device policy. Do not port old MoE offload patches that depended on direct
Go/CGO tensor loading.

The upstream llama-server fit logic can still support large MoE models on
smaller GPUs by overflowing MoE/dense portions into host-backed memory. In logs
this may appear as all logical layers offloaded while a large
`CUDA_Host model buffer` remains. For example, a `qwen3.6:35b` Q4_K load on a
12 GiB RTX 3060 can report:

- `offloaded 42/42 layers to GPU`
- `CUDA0 model buffer size` around 9 GiB
- `CUDA_Host model buffer size` around 12 GiB
- runner VRAM around 10 GiB

That is still CUDA-accelerated inference, not a CPU fallback. The host-backed
expert weight traffic explains longer cold loads and lower throughput than a
model that fits fully inside VRAM.

For explicit policy, Ollama currently exposes coarse placement controls through
llama-server options such as `-ngl`, `--main-gpu`, `--split-mode none`,
`--no-mmap`, `--no-mmproj-offload`, KV cache flags, batch/context sizing, and
flash-attention mode. If upstream llama-server adds or documents a stable
per-expert offload flag, support should be added by plumbing an Ollama option
into `llm/llama_server.go` and scheduler policy.

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
- `runner/README.md`
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
- `app/README.md`
- `app/ui/app/README.md`
- `Dockerfile`

## Safe next steps for the standalone PWA

- Keep PWA work separate from runner compatibility work in commits and review.
- This branch now carries the standalone PWA/UI changes on top of the
  llama-server baseline, so future UI changes should stay in `app/` unless a
  backend API is genuinely required.
- Avoid touching `llm/`, `server/sched.go`, `discover/`, `ml/`, or
  `llama/server/` for PWA work unless the UI genuinely needs a backend API.
- Validate the PWA with its own build and browser checks, then run the normal Go
  and native smoke checks to prove it did not disturb runner packaging.
- Recommended UI checks live in `app/ui/app/README.md`: `npm run lint`,
  `npm run typecheck`, `npm run test`, `npm run build`, and
  `npm run build:standalone`.
