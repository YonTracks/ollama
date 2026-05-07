package server

import (
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/ollama/ollama/api"
	"github.com/ollama/ollama/envconfig"
	"github.com/ollama/ollama/format"
	"github.com/ollama/ollama/fs/ggml"
	"github.com/ollama/ollama/llm"
	"github.com/ollama/ollama/ml"
	"github.com/ollama/ollama/x/imagegen"
	"github.com/ollama/ollama/x/mlxrunner"
)

func (s *Scheduler) newServerForRequest(req *LlmRequest, systemInfo ml.SystemInfo, gpus []ml.DeviceInfo, opts api.Options, numParallel int) (llm.LlamaServer, error) {
	if !req.model.IsMLX() {
		f, loadErr := llm.LoadModel(req.model.ModelPath, 1024)
		if loadErr != nil {
			slog.Info("failed to load model metadata", "model", req.model.ModelPath, "error", loadErr)
			return nil, loadErr
		}

		llama, err := s.newServerFn(systemInfo, gpus, req.model.ModelPath, f, req.model.AdapterPaths, req.model.ProjectorPaths, opts, numParallel)
		if err != nil {
			// Some older models are not compatible with newer versions of llama.cpp.
			// Show a generalized compatibility error until there is a better way to
			// check for model compatibility.
			if errors.Is(err, ggml.ErrUnsupportedFormat) || strings.Contains(err.Error(), "failed to load model") {
				err = fmt.Errorf("%v: this model may be incompatible with your version of Ollama. If you previously pulled this model, try updating it by running `ollama pull %s`", err, req.model.ShortName)
			}
		}

		return llama, err
	}

	modelName := req.model.ShortName
	if slices.Contains(req.model.Config.Capabilities, "image") {
		return imagegen.NewServer(modelName)
	}

	return mlxrunner.NewClient(modelName)
}

func (s *Scheduler) closeActiveLoading() {
	if s.activeLoading != nil {
		s.activeLoading.Close()
		s.activeLoading = nil
	}
}

func likelyMemoryRelatedLoadError(err error) bool {
	if err == nil {
		return false
	}

	if errors.Is(err, llm.ErrLoadRequiredFull) {
		return true
	}

	var noMem ml.ErrNoMem
	if errors.As(err, &noMem) {
		return true
	}

	msg := strings.ToLower(err.Error())
	for _, needle := range []string{
		"out of memory",
		"insufficient memory",
		"failed to allocate memory",
		"failed to commit memory",
		"memory layout cannot be allocated",
		"requires more system memory",
		"requires more gpu memory",
		"not enough memory",
		"cuda error",
		"cuda malloc",
		"alloc failed",
	} {
		if strings.Contains(msg, needle) {
			return true
		}
	}

	return false
}

func lowVRAMKVCacheTypeForOptions(opts api.Options) string {
	if opts.Runner.KvCacheType != "" {
		return strings.ToLower(opts.Runner.KvCacheType)
	}

	if kv := envconfig.EffectiveKVCacheType(); kv != "" {
		return strings.ToLower(kv)
	}

	return "f16"
}

func lowVRAMRetryKVCacheTypes(current string) []string {
	current = strings.ToLower(strings.TrimSpace(current))
	if !envconfig.ValidKVCacheType(current) || current == "" {
		current = "f16"
	}

	order := []string{"f16", "q8_0", "q4_0"}
	start := 0
	for i, kv := range order {
		if kv == current {
			start = i
			break
		}
	}

	return order[start:]
}

func lowVRAMRetryOptions(opts api.Options) []api.Options {
	currentKV := lowVRAMKVCacheTypeForOptions(opts)
	kvs := lowVRAMRetryKVCacheTypes(currentKV)
	contexts := envconfig.LowVRAMRetryContexts()
	seen := map[string]bool{}
	var out []api.Options

	for _, ctx := range contexts {
		if ctx <= 0 {
			continue
		}
		if opts.NumCtx > 0 && ctx > opts.NumCtx {
			continue
		}

		for _, kv := range kvs {
			key := fmt.Sprintf("%d/%s", ctx, kv)
			if seen[key] {
				continue
			}
			seen[key] = true

			if ctx == opts.NumCtx && kv == currentKV {
				continue
			}

			next := opts
			next.NumCtx = ctx
			next.Runner.KvCacheType = kv
			out = append(out, next)
		}
	}

	return out
}

func logLowVRAMMemorySnapshot(phase string, req *LlmRequest, systemInfo ml.SystemInfo, gpus []ml.DeviceInfo, llama llm.LlamaServer) {
	if !envconfig.LowVRAMEnabled() || !envconfig.LowVRAMVerbose() {
		return
	}

	var gpuAvailable uint64
	for _, gpu := range gpus {
		if gpu.FreeMemory > envconfig.GpuOverhead()+gpu.MinimumMemory() {
			gpuAvailable += gpu.FreeMemory - envconfig.GpuOverhead() - gpu.MinimumMemory()
		}
	}

	var total, vram uint64
	if llama != nil {
		total, vram = llama.MemorySize()
	}

	modelName := ""
	if req.model != nil {
		modelName = req.model.ShortName
		if modelName == "" {
			modelName = req.model.Name
		}
	}

	slog.Info("low_vram memory",
		"phase", phase,
		"model", modelName,
		"ctx", req.opts.NumCtx,
		"kv_cache_type", lowVRAMKVCacheTypeForOptions(req.opts),
		"gpu_memory_available", format.HumanBytes2(gpuAvailable),
		"system_memory_available", format.HumanBytes2(systemInfo.FreeMemory),
		"system_swap_available", format.HumanBytes2(systemInfo.FreeSwap),
		"estimated_model_memory", format.HumanBytes2(total),
		"estimated_model_vram", format.HumanBytes2(vram))
}

func logLowVRAMLoadResult(phase string, req *LlmRequest, err error) {
	if !envconfig.LowVRAMEnabled() || !envconfig.LowVRAMVerbose() {
		return
	}

	attrs := []any{
		"phase", phase,
		"ctx", req.opts.NumCtx,
		"kv_cache_type", lowVRAMKVCacheTypeForOptions(req.opts),
	}
	if req.model != nil {
		attrs = append(attrs, "model", req.model.ShortName)
	}
	if err != nil {
		attrs = append(attrs, "error", err)
	}

	slog.Info("low_vram load result", attrs...)
}

func (s *Scheduler) retryLowVRAMLoad(req *LlmRequest, systemInfo ml.SystemInfo, gpus []ml.DeviceInfo, requireFull bool, numParallel int, current llm.LlamaServer, firstErr error) (llm.LlamaServer, []ml.DeviceID, error) {
	if !envconfig.LowVRAMEnabled() || !likelyMemoryRelatedLoadError(firstErr) {
		return current, nil, firstErr
	}

	attempts := lowVRAMRetryOptions(req.opts)
	if len(attempts) == 0 {
		return current, nil, firstErr
	}

	prevCtx := req.opts.NumCtx
	prevKV := lowVRAMKVCacheTypeForOptions(req.opts)
	for i, opts := range attempts {
		if req.ctx.Err() != nil {
			return current, nil, req.ctx.Err()
		}

		retryKV := lowVRAMKVCacheTypeForOptions(opts)
		slog.Info("low_vram retry: load failed; retrying",
			"attempt", i+1,
			"max_attempts", len(attempts),
			"failed_ctx", prevCtx,
			"failed_kv", prevKV,
			"retry_ctx", opts.NumCtx,
			"retry_kv", retryKV,
			"error", firstErr)

		if current != nil {
			current.Close()
		}
		if s.activeLoading == current {
			s.activeLoading = nil
		}

		req.opts = opts
		next, err := s.newServerForRequest(req, systemInfo, gpus, opts, numParallel)
		if err != nil {
			slog.Info("low_vram retry: failed to create server", "attempt", i+1, "ctx", opts.NumCtx, "kv", retryKV, "error", err)
			current = nil
			if !likelyMemoryRelatedLoadError(err) {
				return current, nil, firstErr
			}
			prevCtx = opts.NumCtx
			prevKV = retryKV
			continue
		}

		current = next
		s.activeLoading = current
		logLowVRAMMemorySnapshot("retry_before_load", req, systemInfo, gpus, current)
		gpuIDs, err := current.Load(req.ctx, systemInfo, gpus, requireFull)
		if err == nil {
			slog.Info("low_vram retry: load succeeded", "attempt", i+1, "ctx", opts.NumCtx, "kv", retryKV)
			return current, gpuIDs, nil
		}

		logLowVRAMMemorySnapshot("retry_after_failure", req, systemInfo, gpus, current)
		slog.Info("low_vram retry: load failed", "attempt", i+1, "ctx", opts.NumCtx, "kv", retryKV, "error", err)
		if !likelyMemoryRelatedLoadError(err) {
			return current, nil, firstErr
		}

		prevCtx = opts.NumCtx
		prevKV = retryKV
	}

	slog.Info("low_vram retry: all attempts failed", "attempts", len(attempts), "original_error", firstErr)
	return current, nil, firstErr
}
