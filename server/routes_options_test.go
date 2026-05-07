package server

import (
	"testing"

	"github.com/ollama/ollama/envconfig"
)

func clearModelOptionsEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		envconfig.ContextLengthEnvVar,
		envconfig.ContextLengthSourceEnvVar,
		"OLLAMA_LOW_VRAM_OPTIMIZE",
		"OLLAMA_LOW_VRAM_NUM_CTX",
		"OLLAMA_LOW_VRAM_VERBOSE",
	} {
		t.Setenv(key, "")
	}
}

func TestModelOptionsNumCtxPriority(t *testing.T) {
	tests := []struct {
		name           string
		envContextLen  string // empty means not set (uses 0 sentinel)
		defaultNumCtx  int    // VRAM-based default
		modelNumCtx    int    // 0 means not set in model
		requestNumCtx  int    // 0 means not set in request
		lowVRAM        bool
		lowVRAMEnv     string
		lowVRAMNumCtx  string
		expectedNumCtx int
	}{
		{
			name:           "vram default when nothing else set",
			envContextLen:  "",
			defaultNumCtx:  32768,
			modelNumCtx:    0,
			requestNumCtx:  0,
			expectedNumCtx: 32768,
		},
		{
			name:           "env var overrides vram default",
			envContextLen:  "8192",
			defaultNumCtx:  32768,
			modelNumCtx:    0,
			requestNumCtx:  0,
			expectedNumCtx: 8192,
		},
		{
			name:           "model overrides vram default",
			envContextLen:  "",
			defaultNumCtx:  32768,
			modelNumCtx:    16384,
			requestNumCtx:  0,
			expectedNumCtx: 16384,
		},
		{
			name:           "model overrides env var",
			envContextLen:  "8192",
			defaultNumCtx:  32768,
			modelNumCtx:    16384,
			requestNumCtx:  0,
			expectedNumCtx: 16384,
		},
		{
			name:           "request overrides everything",
			envContextLen:  "8192",
			defaultNumCtx:  32768,
			modelNumCtx:    16384,
			requestNumCtx:  4096,
			expectedNumCtx: 4096,
		},
		{
			name:           "request overrides vram default",
			envContextLen:  "",
			defaultNumCtx:  32768,
			modelNumCtx:    0,
			requestNumCtx:  4096,
			expectedNumCtx: 4096,
		},
		{
			name:           "request overrides model",
			envContextLen:  "",
			defaultNumCtx:  32768,
			modelNumCtx:    16384,
			requestNumCtx:  4096,
			expectedNumCtx: 4096,
		},
		{
			name:           "low vram tier default",
			envContextLen:  "",
			defaultNumCtx:  4096,
			modelNumCtx:    0,
			requestNumCtx:  0,
			expectedNumCtx: 4096,
		},
		{
			name:           "high vram tier default",
			envContextLen:  "",
			defaultNumCtx:  262144,
			modelNumCtx:    0,
			requestNumCtx:  0,
			expectedNumCtx: 262144,
		},
		{
			name:           "low vram disabled keeps existing vram default",
			envContextLen:  "",
			defaultNumCtx:  32768,
			modelNumCtx:    0,
			requestNumCtx:  0,
			lowVRAM:        false,
			lowVRAMNumCtx:  "2048",
			expectedNumCtx: 32768,
		},
		{
			name:           "low vram explicitly disabled keeps existing vram default",
			envContextLen:  "",
			defaultNumCtx:  32768,
			modelNumCtx:    0,
			requestNumCtx:  0,
			lowVRAMEnv:     "0",
			lowVRAMNumCtx:  "2048",
			expectedNumCtx: 32768,
		},
		{
			name:           "low vram enabled applies default when unset",
			envContextLen:  "",
			defaultNumCtx:  32768,
			modelNumCtx:    0,
			requestNumCtx:  0,
			lowVRAM:        true,
			expectedNumCtx: 4096,
		},
		{
			name:           "low vram custom default applies when unset",
			envContextLen:  "",
			defaultNumCtx:  32768,
			modelNumCtx:    0,
			requestNumCtx:  0,
			lowVRAM:        true,
			lowVRAMNumCtx:  "2048",
			expectedNumCtx: 2048,
		},
		{
			name:           "model num ctx wins in low vram mode",
			envContextLen:  "",
			defaultNumCtx:  32768,
			modelNumCtx:    8192,
			requestNumCtx:  0,
			lowVRAM:        true,
			expectedNumCtx: 8192,
		},
		{
			name:           "request num ctx wins in low vram mode",
			envContextLen:  "",
			defaultNumCtx:  32768,
			modelNumCtx:    8192,
			requestNumCtx:  6144,
			lowVRAM:        true,
			expectedNumCtx: 6144,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clearModelOptionsEnv(t)

			// Set or clear environment variable
			if tt.envContextLen != "" {
				t.Setenv(envconfig.ContextLengthEnvVar, tt.envContextLen)
			}
			if tt.lowVRAMEnv != "" {
				t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", tt.lowVRAMEnv)
			} else if tt.lowVRAM {
				t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
			}
			if tt.lowVRAMNumCtx != "" {
				t.Setenv("OLLAMA_LOW_VRAM_NUM_CTX", tt.lowVRAMNumCtx)
			}

			// Create server with VRAM-based default
			s := &Server{
				defaultNumCtx: tt.defaultNumCtx,
			}

			// Create model options (use float64 as FromMap expects JSON-style numbers)
			var modelOpts map[string]any
			if tt.modelNumCtx != 0 {
				modelOpts = map[string]any{"num_ctx": float64(tt.modelNumCtx)}
			}
			model := &Model{
				Options: modelOpts,
			}

			// Create request options (use float64 as FromMap expects JSON-style numbers)
			var requestOpts map[string]any
			if tt.requestNumCtx != 0 {
				requestOpts = map[string]any{"num_ctx": float64(tt.requestNumCtx)}
			}

			opts, err := s.modelOptions(model, requestOpts)
			if err != nil {
				t.Fatalf("modelOptions failed: %v", err)
			}

			if opts.NumCtx != tt.expectedNumCtx {
				t.Errorf("NumCtx = %d, want %d", opts.NumCtx, tt.expectedNumCtx)
			}
		})
	}
}
