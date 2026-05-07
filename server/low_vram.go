package server

import (
	"log/slog"

	"github.com/ollama/ollama/api"
	"github.com/ollama/ollama/envconfig"
)

func hasOption(m map[string]any, key string) bool {
	if m == nil {
		return false
	}

	_, ok := m[key]
	return ok
}

func optionInt(m map[string]any, key string) (int, bool) {
	if m == nil {
		return 0, false
	}

	v, ok := m[key]
	if !ok {
		return 0, false
	}

	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	default:
		return 0, true
	}
}

func shouldApplyLowVRAMNumCtxDefault(model *Model, requestOpts map[string]any) bool {
	if !envconfig.LowVRAMEnabled() {
		return false
	}

	if model != nil && hasOption(model.Options, "num_ctx") {
		return false
	}

	return !hasOption(requestOpts, "num_ctx")
}

func logLowVRAMModelOptions(model *Model, requestOpts map[string]any, opts api.Options, lowDefaultApplied bool) {
	if !envconfig.LowVRAMEnabled() || !envconfig.LowVRAMVerbose() {
		return
	}

	var modelName string
	var modelOpts map[string]any
	if model != nil {
		modelName = model.ShortName
		if modelName == "" {
			modelName = model.Name
		}
		modelOpts = model.Options
	}

	modelCtx, modelCtxSet := optionInt(modelOpts, "num_ctx")
	requestCtx, requestCtxSet := optionInt(requestOpts, "num_ctx")
	requestedCtx := int(envconfig.ContextLength())
	requestedCtxSource := "default"
	if requestedCtx != 0 {
		requestedCtxSource = envconfig.ContextLengthSource()
	}
	switch {
	case requestCtxSet:
		requestedCtx = requestCtx
		requestedCtxSource = "request"
	case modelCtxSet:
		requestedCtx = modelCtx
		requestedCtxSource = "model"
	case requestedCtx == 0:
		requestedCtxSource = "default"
	}

	slog.Info("low_vram model options",
		"enabled", envconfig.LowVRAMEnabled(),
		"model", modelName,
		"requested_context", requestedCtx,
		"requested_context_source", requestedCtxSource,
		"effective_context", opts.NumCtx,
		"low_vram_context_default_applied", lowDefaultApplied,
		"requested_kv_cache_type", envconfig.KvCacheType(),
		"low_vram_kv_cache_type", envconfig.LowVRAMKVCacheType(),
		"effective_kv_cache_type", envconfig.EffectiveKVCacheType(),
		"flash_attention_requested", envconfig.LowVRAMFlashAttention() || envconfig.FlashAttention(false),
		"num_parallel_effective", envconfig.EffectiveNumParallel(),
		"max_loaded_models_effective", envconfig.EffectiveMaxRunners())
}
