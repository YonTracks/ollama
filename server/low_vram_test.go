package server

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/ollama/ollama/api"
	"github.com/ollama/ollama/envconfig"
	"github.com/ollama/ollama/fs/ggml"
	"github.com/ollama/ollama/llm"
	"github.com/ollama/ollama/ml"
)

func captureDefaultLogs(t *testing.T) *bytes.Buffer {
	t.Helper()

	var logs bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	return &logs
}

func TestLogLowVRAMModelOptionsContextSource(t *testing.T) {
	previousLogger := slog.Default()
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	tests := []struct {
		name       string
		envCtx     string
		envSource  string
		modelOpts  map[string]any
		requestOpt map[string]any
		wantSource string
	}{
		{
			name:       "direct environment context length",
			envCtx:     "8192",
			wantSource: envconfig.ContextLengthSourceEnvironment,
		},
		{
			name:       "app global context setting",
			envCtx:     "8192",
			envSource:  envconfig.ContextLengthSourceGlobalSetting,
			wantSource: envconfig.ContextLengthSourceGlobalSetting,
		},
		{
			name:       "default context length",
			wantSource: "default",
		},
		{
			name:       "model option overrides global context setting",
			envCtx:     "8192",
			envSource:  envconfig.ContextLengthSourceGlobalSetting,
			modelOpts:  map[string]any{"num_ctx": float64(4096)},
			wantSource: "model",
		},
		{
			name:       "request option overrides global context setting",
			envCtx:     "8192",
			envSource:  envconfig.ContextLengthSourceGlobalSetting,
			requestOpt: map[string]any{"num_ctx": float64(2048)},
			wantSource: "request",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logs := captureDefaultLogs(t)
			t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
			t.Setenv("OLLAMA_LOW_VRAM_VERBOSE", "1")
			t.Setenv(envconfig.ContextLengthEnvVar, tt.envCtx)
			t.Setenv(envconfig.ContextLengthSourceEnvVar, tt.envSource)

			model := &Model{ShortName: "test-model", Options: tt.modelOpts}
			opts := api.Options{Runner: api.Runner{NumCtx: 4096}}
			logLowVRAMModelOptions(model, tt.requestOpt, opts, false)

			want := "requested_context_source=" + tt.wantSource
			if got := logs.String(); !strings.Contains(got, want) {
				t.Fatalf("logLowVRAMModelOptions log missing %q:\n%s", want, got)
			}
		})
	}
}

func TestLogLowVRAMModelOptionsDisabledIsQuiet(t *testing.T) {
	previousLogger := slog.Default()
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	logs := captureDefaultLogs(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "0")
	t.Setenv("OLLAMA_LOW_VRAM_VERBOSE", "1")
	t.Setenv("OLLAMA_LOW_VRAM_KV_CACHE_TYPE", "q8_0")

	model := &Model{ShortName: "test-model"}
	opts := api.Options{Runner: api.Runner{NumCtx: 4096}}
	logLowVRAMModelOptions(model, nil, opts, false)

	if got := logs.String(); strings.Contains(got, "low_vram model options") {
		t.Fatalf("low-VRAM model options log emitted while disabled:\n%s", got)
	}
}

func TestLowVRAMMemoryLogsDisabledAreQuiet(t *testing.T) {
	previousLogger := slog.Default()
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	logs := captureDefaultLogs(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "0")
	t.Setenv("OLLAMA_LOW_VRAM_VERBOSE", "1")
	t.Setenv("OLLAMA_LOW_VRAM_KV_CACHE_TYPE", "q8_0")

	req := &LlmRequest{
		model: &Model{ShortName: "memory-test"},
		opts:  api.Options{Runner: api.Runner{NumCtx: 4096}},
	}
	logLowVRAMMemorySnapshot("before_load", req, ml.SystemInfo{}, nil, nil)
	logLowVRAMLoadResult("failure", req, errors.New("out of memory"))

	got := logs.String()
	for _, unwanted := range []string{"low_vram memory", "low_vram load result"} {
		if strings.Contains(got, unwanted) {
			t.Fatalf("%q log emitted while disabled:\n%s", unwanted, got)
		}
	}
}

func TestLowVRAMMemoryLogsEnabledVerbose(t *testing.T) {
	previousLogger := slog.Default()
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	logs := captureDefaultLogs(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_LOW_VRAM_VERBOSE", "1")

	req := &LlmRequest{
		model: &Model{ShortName: "memory-test"},
		opts:  api.Options{Runner: api.Runner{NumCtx: 4096}},
	}
	logLowVRAMMemorySnapshot("before_load", req, ml.SystemInfo{}, nil, nil)
	logLowVRAMLoadResult("success", req, nil)

	got := logs.String()
	for _, want := range []string{"low_vram memory", "low_vram load result"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q log while enabled:\n%s", want, got)
		}
	}
}

func TestRetryLowVRAMLoadDisabledDoesNotRetry(t *testing.T) {
	previousLogger := slog.Default()
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	logs := captureDefaultLogs(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "0")
	t.Setenv("OLLAMA_LOW_VRAM_VERBOSE", "1")
	t.Setenv("OLLAMA_LOW_VRAM_RETRY_CTX", "4096,2048")
	t.Setenv("OLLAMA_LOW_VRAM_KV_CACHE_TYPE", "q8_0")

	firstErr := errors.New("failed to allocate memory")
	current := &mockLlm{vramByGPU: map[ml.DeviceID]uint64{}}
	newServerCalls := 0
	s := &Scheduler{
		newServerFn: func(systemInfo ml.SystemInfo, gpus []ml.DeviceInfo, model string, f *ggml.GGML, adapters []string, projectors []string, opts api.Options, numParallel int) (llm.LlamaServer, error) {
			newServerCalls++
			return current, nil
		},
	}
	req := &LlmRequest{
		ctx:   t.Context(),
		model: &Model{ShortName: "retry-disabled"},
		opts:  api.Options{Runner: api.Runner{NumCtx: 8192}},
	}

	got, gpuIDs, err := s.retryLowVRAMLoad(req, ml.SystemInfo{}, nil, false, 1, current, firstErr)
	if !errors.Is(err, firstErr) {
		t.Fatalf("retryLowVRAMLoad() error = %v, want %v", err, firstErr)
	}
	if got != current {
		t.Fatalf("retryLowVRAMLoad() server = %v, want current", got)
	}
	if gpuIDs != nil {
		t.Fatalf("retryLowVRAMLoad() gpuIDs = %v, want nil", gpuIDs)
	}
	if newServerCalls != 0 {
		t.Fatalf("retryLowVRAMLoad() created %d retry servers while disabled", newServerCalls)
	}
	if got := logs.String(); strings.Contains(got, "low_vram") {
		t.Fatalf("low-VRAM retry log emitted while disabled:\n%s", got)
	}
}
