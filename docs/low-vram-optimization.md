# Low VRAM Optimization

Ollama includes an experimental low-VRAM optimization mode for systems where GPU memory is tight. It is disabled by default and only changes behavior when explicitly enabled with environment variables.

This pass uses existing Ollama controls:

- lower default context when no model, request, or global context is set
- KV cache quantization preference
- optional Flash Attention preference
- reduced parallel request count
- reduced concurrently loaded model count
- finite retry fallback after likely memory-related load failures
- structured logging for low-VRAM decisions

## Windows Setup

Run these commands in PowerShell or Command Prompt, then restart Ollama:

```bat
setx OLLAMA_LOW_VRAM_OPTIMIZE "1"
setx OLLAMA_LOW_VRAM_FLASH_ATTENTION "1"
setx OLLAMA_LOW_VRAM_KV_CACHE_TYPE "q8_0"
setx OLLAMA_LOW_VRAM_NUM_CTX "4096"
setx OLLAMA_LOW_VRAM_RETRY_CTX "4096,2048,1024"
setx OLLAMA_LOW_VRAM_NUM_PARALLEL "1"
setx OLLAMA_LOW_VRAM_MAX_LOADED_MODELS "1"
setx OLLAMA_LOW_VRAM_VERBOSE "1"
```

Windows environment variable changes made with `setx` apply only to new processes. Fully quit and restart Ollama after changing these values.

## Configuration

### `OLLAMA_LOW_VRAM_OPTIMIZE`

Master switch for the low-VRAM mode.

- `1` = enable low-VRAM optimization
- `0` = disable low-VRAM optimization and return to normal behavior

When this is disabled, the other `OLLAMA_LOW_VRAM_*` settings should be ignored.

### `OLLAMA_LOW_VRAM_FLASH_ATTENTION`

Requests Flash Attention when supported.

Recommended:

```bat
setx OLLAMA_LOW_VRAM_FLASH_ATTENTION "1"
```

### `OLLAMA_LOW_VRAM_KV_CACHE_TYPE`

Preferred KV cache precision for low-VRAM mode.

Supported values:

- `f16`
- `q8_0`
- `q4_0`

Recommended starting point:

```bat
setx OLLAMA_LOW_VRAM_KV_CACHE_TYPE "q8_0"
```

### `OLLAMA_LOW_VRAM_NUM_CTX`

Default context length to use in low-VRAM mode when no explicit context has already been set.

Recommended starting point:

```bat
setx OLLAMA_LOW_VRAM_NUM_CTX "4096"
```

### `OLLAMA_LOW_VRAM_RETRY_CTX`

Comma-separated list of smaller context lengths to retry if model loading fails due to memory pressure.

Example:

```bat
setx OLLAMA_LOW_VRAM_RETRY_CTX "4096,2048,1024"
```

### `OLLAMA_LOW_VRAM_NUM_PARALLEL`

Preferred number of parallel requests in low-VRAM mode.

Recommended:

```bat
setx OLLAMA_LOW_VRAM_NUM_PARALLEL "1"
```

### `OLLAMA_LOW_VRAM_MAX_LOADED_MODELS`

Preferred maximum number of loaded models in low-VRAM mode.

Recommended:

```bat
setx OLLAMA_LOW_VRAM_MAX_LOADED_MODELS "1"
```

### `OLLAMA_LOW_VRAM_VERBOSE`

Enables structured low-VRAM logging.

Recommended while testing:

```bat
setx OLLAMA_LOW_VRAM_VERBOSE "1"
```

## Context Precedence

Low-VRAM context defaults are only applied when no higher-priority context value has already been set.

Typical precedence is:

1. request/model-specific context
2. global Ollama app setting / global context configuration
3. low-VRAM default context (`OLLAMA_LOW_VRAM_NUM_CTX`)

This means that if the Ollama app is already configured to use a context such as `16384`, the low-VRAM default of `4096` will not override it.

## Guidance

Start with `4096` context on 12GB GPUs. Larger context uses more memory, especially through the KV cache.

Try `q8_0` KV cache first. Use `q4_0` only if memory is still tight.

Flash Attention may be required for quantized KV cache on some runners and models. If it is unsupported by the GPU or model, Ollama will warn and continue safely.

Parallel requests multiply memory pressure. Keep `OLLAMA_LOW_VRAM_NUM_PARALLEL` at `1` while tuning.

Limit loaded models with `OLLAMA_LOW_VRAM_MAX_LOADED_MODELS=1` to reduce VRAM contention.

Use `ollama ps` to check the CPU/GPU split and the active context length for loaded models.

## Experimental MoE Offload

Large GGUF MoE models can still require a lot of VRAM because the full model weights must be available even though only some experts are active for each token. The bundled llama.cpp backend supports tensor buffer overrides, so the classic Ollama llama runner can place MoE expert tensors in CPU/system RAM through the internal load request path.

This is only considered when low-VRAM mode and `OLLAMA_MOE_CPU_OFFLOAD=1` are enabled. It is mainly useful for MoE GGUF models; dense models usually benefit less. Moving expert tensors to CPU/system RAM may reduce VRAM usage, but it can also reduce token speed.

MoE offload is currently applied by the classic bundled llama runner. Some model architectures are routed through Ollama's newer internal engine even when `OLLAMA_NEW_ENGINE=0`; that runner mode does not yet expose tensor buffer overrides. In that case verbose logs should still show `requested=true`, but `supported=false`, `applied=false`, and a reason.

For debugging the classic llama.cpp path, you can request the classic runner explicitly:

```bat
setx OLLAMA_NEW_ENGINE "false"
setx OLLAMA_FORCE_CLASSIC_LLAMA_RUNNER "1"
```

This is a test-only escape hatch. If the classic runner can load the model, verbose logs should show `runner_kind=classic_llama` and the MoE load request fields. If the architecture cannot be loaded by classic llama.cpp, Ollama logs why and falls back to the engine path only with an explicit runner-selection reason.

Example:

```bat
setx OLLAMA_LOW_VRAM_OPTIMIZE "1"
setx OLLAMA_MOE_CPU_OFFLOAD "1"
setx OLLAMA_MOE_CPU_OFFLOAD_POLICY "gpu_resident"
setx OLLAMA_MOE_CPU_OFFLOAD_LAYERS "12"
setx OLLAMA_LOW_VRAM_VERBOSE "1"
```

### Experimental MoE CPU Offload Policies

`OLLAMA_MOE_CPU_OFFLOAD_POLICY` controls which MoE expert tensor layers are targeted:

- `first`: offload `blk.0` upward. This is the default for backward compatibility when the policy is unset.
- `last`: offload the final `N` transformer blocks.
- `all`: offload all repeating transformer-block MoE expert tensors. Any `OLLAMA_MOE_CPU_OFFLOAD_LAYERS` value is ignored.
- `gpu_resident`: offload expert tensors from layers assigned to GPU by the scheduler. This is usually the most useful low-VRAM test policy when Ollama places only later layers on GPU.

Recommended for targeting the currently GPU-resident expert layers:

```bat
setx OLLAMA_MOE_CPU_OFFLOAD "1"
setx OLLAMA_MOE_CPU_OFFLOAD_POLICY "gpu_resident"
setx OLLAMA_MOE_CPU_OFFLOAD_LAYERS "12"
```

Alternative policies:

```bat
setx OLLAMA_MOE_CPU_OFFLOAD_POLICY "first"
setx OLLAMA_MOE_CPU_OFFLOAD_POLICY "last"
setx OLLAMA_MOE_CPU_OFFLOAD_POLICY "all"
```

`OLLAMA_MOE_CPU_OFFLOAD_LAYERS` limits how many layers are targeted. With `gpu_resident`, the highest GPU-resident layer numbers are preferred first. For example, if the scheduler assigns `blk.24..blk.47` to GPU and the limit is `12`, the override list targets `blk.36..blk.47`.

The scheduler still chooses layer placement before tensor-level overrides are applied. Verbose logs include a note when the reported memory split is adjusted to leave overridden expert tensors on CPU; the initial layer-selection estimate may be conservative.

`qwen3-coder:30b` / `qwen3moe` can use the classic runner tensor override path when the classic runner is selected. `qwen3.6:35b` / `qwen35moe` may still require the Ollama-engine runner, which does not yet expose this internal MoE offload path.

Advanced tensor override example:

```bat
setx OLLAMA_MOE_TENSOR_OVERRIDE ".ffn_.*_exps.=CPU"
```

The tensor override syntax is `PATTERN=CPU`. The pattern is matched against tensor names by the backend during model loading.

Advanced raw llama.cpp passthrough remains guarded and is not used for MoE offload in the bundled runner. The bundled runner applies MoE offload through internal load request fields instead of appending llama.cpp CLI flags.

Use `ollama ps` and verbose low-VRAM logs to confirm the actual CPU/GPU split and whether MoE options were applied. Look for `moe_cpu_offload decision` and `CpuMoeOffload:true` / `CpuMoeOffloadLayers:12` in the runner load option logs. If model loading breaks, unset the MoE variables first and restart Ollama.

## Returning to Default Behavior

The easiest way to return to normal Ollama behavior is to disable the master switch:

```bat
setx OLLAMA_LOW_VRAM_OPTIMIZE "0"
```

Then fully quit and restart Ollama.

The other low-VRAM settings may remain defined, but they should be ignored while `OLLAMA_LOW_VRAM_OPTIMIZE=0`.

## Removing the Variables Completely

If you want to fully remove the low-VRAM settings from the Windows user environment, use PowerShell:

```powershell
[Environment]::SetEnvironmentVariable("OLLAMA_LOW_VRAM_OPTIMIZE", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_LOW_VRAM_FLASH_ATTENTION", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_LOW_VRAM_KV_CACHE_TYPE", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_LOW_VRAM_NUM_CTX", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_LOW_VRAM_RETRY_CTX", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_LOW_VRAM_NUM_PARALLEL", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_LOW_VRAM_MAX_LOADED_MODELS", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_LOW_VRAM_VERBOSE", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_MOE_CPU_OFFLOAD", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_MOE_CPU_OFFLOAD_LAYERS", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_MOE_CPU_OFFLOAD_POLICY", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_MOE_TENSOR_OVERRIDE", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_LLAMA_ARG_PASSTHROUGH", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_FORCE_CLASSIC_LLAMA_RUNNER", $null, "User")
```

Then fully quit and restart Ollama.

## Troubleshooting

### The model is still using a large context

Check whether Ollama app settings or another global configuration is setting a higher context length. Explicit global settings take precedence over the low-VRAM default.

### The model still does not fit

Try:

- lowering context from `4096` to `2048`
- switching KV cache from `q8_0` to `q4_0`
- keeping `OLLAMA_LOW_VRAM_NUM_PARALLEL=1`
- keeping `OLLAMA_LOW_VRAM_MAX_LOADED_MODELS=1`

### Changes do not seem to apply

Remember that `setx` only affects new processes. Fully quit and restart Ollama after making changes.
