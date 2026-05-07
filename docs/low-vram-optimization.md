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
