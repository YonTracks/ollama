package llm

import (
	"errors"
	"strings"
	"testing"

	"github.com/ollama/ollama/llama"
	"github.com/ollama/ollama/tokenizer"
)

func testRunnerSelectionConfig(architecture string, engineRequired bool) runnerSelectionConfig {
	return runnerSelectionConfig{
		ModelPath:        "test-model.gguf",
		Architecture:     architecture,
		EngineRequired:   engineRequired,
		NewEngineSet:     false,
		NewEngineEnabled: false,
		ForceClassic:     false,
	}
}

func testRunnerLoaders(t *testing.T, classicErr, engineErr error, classicCalls, engineCalls *int) runnerLoaders {
	t.Helper()
	return runnerLoaders{
		LoadClassicLlama: func() (*llama.Model, error) {
			*classicCalls = *classicCalls + 1
			if classicErr != nil {
				return nil, classicErr
			}

			return nil, nil
		},
		LoadOllamaEngine: func() (tokenizer.Tokenizer, error) {
			*engineCalls = *engineCalls + 1
			if engineErr != nil {
				return nil, engineErr
			}

			return nil, nil
		},
	}
}

func TestRunnerSelectionNewEngineFalseRoutesClassicWhenSupported(t *testing.T) {
	resetMoEEnv(t)
	cfg := testRunnerSelectionConfig("qwen3moe", true)
	cfg.NewEngineSet = true
	cfg.NewEngineEnabled = false

	var classicCalls, engineCalls int
	_, _, selection, err := selectAndLoadRunner(cfg, testRunnerLoaders(t, nil, nil, &classicCalls, &engineCalls))
	if err != nil {
		t.Fatal(err)
	}
	if selection.Kind != runnerKindClassicLlama {
		t.Fatalf("runner kind = %s, want %s", selection.Kind, runnerKindClassicLlama)
	}
	if !selection.ClassicLlamaAvailable {
		t.Fatalf("ClassicLlamaAvailable = false, want true")
	}
	if classicCalls != 1 || engineCalls != 0 {
		t.Fatalf("classicCalls=%d engineCalls=%d, want 1 and 0", classicCalls, engineCalls)
	}
	if !strings.Contains(selection.Reason, "OLLAMA_NEW_ENGINE=false") {
		t.Fatalf("reason = %q, want OLLAMA_NEW_ENGINE=false", selection.Reason)
	}
}

func TestRunnerSelectionNewEngineFalseLogsReasonWhenEngineStillSelected(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_LOW_VRAM_VERBOSE", "1")

	cfg := testRunnerSelectionConfig("qwen35moe", true)
	cfg.NewEngineSet = true
	cfg.NewEngineEnabled = false

	var classicCalls, engineCalls int
	_, _, selection, err := selectAndLoadRunner(cfg, testRunnerLoaders(t, errors.New("unknown architecture qwen35moe"), nil, &classicCalls, &engineCalls))
	if err != nil {
		t.Fatal(err)
	}
	if selection.Kind != runnerKindOllamaEngine {
		t.Fatalf("runner kind = %s, want %s", selection.Kind, runnerKindOllamaEngine)
	}

	logs := captureLogs(func() {
		logRunnerSelection("qwen3.6:35b", selection)
	})
	for _, want := range []string{
		"runner selection",
		"runner_kind=ollama_engine",
		"new_engine_enabled=false",
		`runner_selection_reason="classic llama runner does not support qwen35moe"`,
	} {
		if !strings.Contains(logs, want) {
			t.Fatalf("logs = %q, want %q", logs, want)
		}
	}
}

func TestRunnerSelectionForceClassicSelectsClassicWhenPossible(t *testing.T) {
	resetMoEEnv(t)
	cfg := testRunnerSelectionConfig("qwen3moe", true)
	cfg.ForceClassic = true

	var classicCalls, engineCalls int
	_, _, selection, err := selectAndLoadRunner(cfg, testRunnerLoaders(t, nil, nil, &classicCalls, &engineCalls))
	if err != nil {
		t.Fatal(err)
	}
	if selection.Kind != runnerKindClassicLlama {
		t.Fatalf("runner kind = %s, want %s", selection.Kind, runnerKindClassicLlama)
	}
	if selection.Reason != "forced by OLLAMA_FORCE_CLASSIC_LLAMA_RUNNER" {
		t.Fatalf("reason = %q, want forced reason", selection.Reason)
	}
	if classicCalls != 1 || engineCalls != 0 {
		t.Fatalf("classicCalls=%d engineCalls=%d, want 1 and 0", classicCalls, engineCalls)
	}
}

func TestRunnerSelectionForceClassicDoesNotSilentlyFallBack(t *testing.T) {
	resetMoEEnv(t)
	cfg := testRunnerSelectionConfig("qwen35moe", true)
	cfg.ForceClassic = true

	var classicCalls, engineCalls int
	var selection runnerSelection
	logs := captureLogs(func() {
		_, _, selection, _ = selectAndLoadRunner(cfg, testRunnerLoaders(t, errors.New("unknown architecture qwen35moe"), nil, &classicCalls, &engineCalls))
	})

	if selection.Kind != runnerKindOllamaEngine {
		t.Fatalf("runner kind = %s, want %s", selection.Kind, runnerKindOllamaEngine)
	}
	if !strings.Contains(selection.Reason, "classic llama runner does not support qwen35moe") {
		t.Fatalf("reason = %q, want classic unsupported reason", selection.Reason)
	}
	if !strings.Contains(logs, "forced classic llama runner unavailable") {
		t.Fatalf("logs = %q, want forced fallback warning", logs)
	}
	if classicCalls != 1 || engineCalls != 1 {
		t.Fatalf("classicCalls=%d engineCalls=%d, want 1 and 1", classicCalls, engineCalls)
	}
}

func TestRunnerSelectionLogIncludesKindAndReason(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_LOW_VRAM_VERBOSE", "1")

	selection := runnerSelection{
		Kind:                  runnerKindClassicLlama,
		Architecture:          "qwen3moe",
		NewEngineRequested:    true,
		NewEngineEnabled:      false,
		NewEngineEffective:    false,
		ForceClassic:          true,
		EngineRequired:        true,
		ClassicLlamaAvailable: true,
		Reason:                "forced by OLLAMA_FORCE_CLASSIC_LLAMA_RUNNER",
	}

	logs := captureLogs(func() {
		logRunnerSelection("qwen3.6:35b", selection)
	})
	for _, want := range []string{
		"runner selection",
		"runner_kind=classic_llama",
		`runner_selection_reason="forced by OLLAMA_FORCE_CLASSIC_LLAMA_RUNNER"`,
		"model_architecture=qwen3moe",
	} {
		if !strings.Contains(logs, want) {
			t.Fatalf("logs = %q, want %q", logs, want)
		}
	}
}
