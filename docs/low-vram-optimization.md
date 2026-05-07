# Low VRAM Optimization

Ollama includes an experimental low-VRAM optimization mode for systems where GPU memory is tight. It is disabled by default and only changes behavior when explicitly enabled with environment variables.

This pass uses existing Ollama controls:

- lower default context when no model or request context is set
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

Windows environment variable changes made with `setx` apply to new processes. Restart Ollama after changing these values.

## Guidance

Start with 4096 context on 12GB GPUs. Larger context uses more memory, especially through the KV cache.

Try `q8_0` KV cache first. Use `q4_0` only if memory is still tight.

Flash Attention may be required for quantized KV cache on some runners and models. If it is unsupported by the GPU or model, Ollama will warn and continue safely.

Parallel requests multiply memory pressure. Keep `OLLAMA_LOW_VRAM_NUM_PARALLEL` at `1` while tuning.

Limit loaded models with `OLLAMA_LOW_VRAM_MAX_LOADED_MODELS=1` to reduce VRAM contention.

Use `ollama ps` to check the CPU/GPU split and the active context length for loaded models.
