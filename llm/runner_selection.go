package llm

import (
	"errors"
	"fmt"
	"log/slog"

	"github.com/ollama/ollama/envconfig"
	"github.com/ollama/ollama/fs/ggml"
	"github.com/ollama/ollama/llama"
	"github.com/ollama/ollama/model"
	"github.com/ollama/ollama/tokenizer"
)

type runnerSelection struct {
	Kind                  runnerKind
	Architecture          string
	NewEngineRequested    bool
	NewEngineEnabled      bool
	NewEngineEffective    bool
	ForceClassic          bool
	EngineRequired        bool
	ClassicLlamaAvailable bool
	OllamaEngineAvailable bool
	Reason                string
	ClassicError          string
	OllamaEngineError     string
}

type runnerSelectionConfig struct {
	ModelPath        string
	Architecture     string
	EngineRequired   bool
	ProjectorCount   int
	NewEngineSet     bool
	NewEngineEnabled bool
	ForceClassic     bool
}

type runnerLoaders struct {
	LoadOllamaEngine func() (tokenizer.Tokenizer, error)
	LoadClassicLlama func() (*llama.Model, error)
}

func newRunnerSelectionConfig(modelPath string, f *ggml.GGML, projectors []string) runnerSelectionConfig {
	return runnerSelectionConfig{
		ModelPath:        modelPath,
		Architecture:     f.KV().Architecture(),
		EngineRequired:   f.KV().OllamaEngineRequired(),
		ProjectorCount:   len(projectors),
		NewEngineSet:     envconfig.IsSet("OLLAMA_NEW_ENGINE"),
		NewEngineEnabled: envconfig.NewEngine(),
		ForceClassic:     envconfig.ForceClassicLlamaRunner(),
	}
}

func newRunnerLoaders(modelPath string, projectors []string) runnerLoaders {
	return runnerLoaders{
		LoadOllamaEngine: func() (tokenizer.Tokenizer, error) {
			if len(projectors) != 0 {
				return nil, errors.New("split vision models aren't supported")
			}

			return model.NewTextProcessor(modelPath)
		},
		LoadClassicLlama: func() (*llama.Model, error) {
			return llama.LoadModelFromFile(modelPath, llama.ModelParams{VocabOnly: true})
		},
	}
}

func selectAndLoadRunner(cfg runnerSelectionConfig, loaders runnerLoaders) (*llama.Model, tokenizer.Tokenizer, runnerSelection, error) {
	selection := runnerSelection{
		Architecture:       cfg.Architecture,
		NewEngineRequested: cfg.NewEngineSet,
		NewEngineEnabled:   cfg.NewEngineEnabled,
		ForceClassic:       cfg.ForceClassic,
		EngineRequired:     cfg.EngineRequired,
	}

	tryClassic := func(reason string, allowEngineFallback bool) (*llama.Model, tokenizer.Tokenizer, runnerSelection, error) {
		llamaModel, err := loaders.LoadClassicLlama()
		if err == nil {
			selection.Kind = runnerKindClassicLlama
			selection.NewEngineEffective = false
			selection.ClassicLlamaAvailable = true
			selection.Reason = reason
			return llamaModel, nil, selection, nil
		}

		selection.ClassicLlamaAvailable = false
		selection.ClassicError = err.Error()
		if !allowEngineFallback {
			selection.Kind = runnerKindClassicLlama
			selection.NewEngineEffective = false
			selection.Reason = fmt.Sprintf("classic llama runner does not support %s", cfg.Architecture)
			return nil, nil, selection, fmt.Errorf("%s: %w", selection.Reason, err)
		}

		if cfg.ForceClassic {
			slog.Warn("forced classic llama runner unavailable, falling back to Ollama engine", "architecture", cfg.Architecture, "error", err)
		}

		tok, engineErr := loaders.LoadOllamaEngine()
		if engineErr != nil {
			selection.Kind = runnerKindOllamaEngine
			selection.NewEngineEffective = true
			selection.OllamaEngineAvailable = false
			selection.OllamaEngineError = engineErr.Error()
			selection.Reason = fmt.Sprintf("classic llama runner does not support %s and Ollama engine is unavailable", cfg.Architecture)
			return nil, nil, selection, fmt.Errorf("%s: classic error: %w; engine error: %w", selection.Reason, err, engineErr)
		}

		selection.Kind = runnerKindOllamaEngine
		selection.NewEngineEffective = true
		selection.OllamaEngineAvailable = true
		selection.Reason = fmt.Sprintf("classic llama runner does not support %s", cfg.Architecture)
		return nil, tok, selection, nil
	}

	tryEngine := func(reason string) (*llama.Model, tokenizer.Tokenizer, runnerSelection, error) {
		tok, err := loaders.LoadOllamaEngine()
		if err == nil {
			selection.Kind = runnerKindOllamaEngine
			selection.NewEngineEffective = true
			selection.OllamaEngineAvailable = true
			selection.Reason = reason
			return nil, tok, selection, nil
		}

		selection.OllamaEngineAvailable = false
		selection.OllamaEngineError = err.Error()
		slog.Debug("model not yet supported by Ollama engine, switching to compatibility mode", "model", cfg.ModelPath, "error", err)

		llamaModel, classicErr := loaders.LoadClassicLlama()
		if classicErr != nil {
			selection.Kind = runnerKindClassicLlama
			selection.NewEngineEffective = false
			selection.ClassicLlamaAvailable = false
			selection.ClassicError = classicErr.Error()
			selection.Reason = "Ollama engine unavailable and classic llama runner also failed"
			return nil, nil, selection, fmt.Errorf("%s: engine error: %w; classic error: %w", selection.Reason, err, classicErr)
		}

		selection.Kind = runnerKindClassicLlama
		selection.NewEngineEffective = false
		selection.ClassicLlamaAvailable = true
		selection.Reason = "Ollama engine unavailable, switching to compatibility mode"
		return llamaModel, nil, selection, nil
	}

	switch {
	case cfg.ForceClassic:
		return tryClassic("forced by OLLAMA_FORCE_CLASSIC_LLAMA_RUNNER", true)
	case cfg.NewEngineEnabled:
		return tryEngine("OLLAMA_NEW_ENGINE=true")
	case cfg.EngineRequired && !cfg.NewEngineSet:
		return tryEngine("architecture requires Ollama engine")
	case cfg.EngineRequired && cfg.NewEngineSet:
		return tryClassic("OLLAMA_NEW_ENGINE=false requested and classic llama runner is available", true)
	default:
		return tryClassic("default selection", false)
	}
}

func logRunnerSelection(modelPath string, selection runnerSelection) {
	if !envconfig.LowVRAMEnabled() || !envconfig.LowVRAMVerbose() {
		return
	}

	attrs := []any{
		"model", modelPath,
		"architecture", selection.Architecture,
		"model_architecture", selection.Architecture,
		"runner_kind", selection.Kind,
		"new_engine_enabled", selection.NewEngineEnabled,
		"new_engine_requested", selection.NewEngineRequested,
		"new_engine_effective", selection.NewEngineEffective,
		"force_classic", selection.ForceClassic,
		"engine_required", selection.EngineRequired,
		"classic_llama_available", selection.ClassicLlamaAvailable,
		"ollama_engine_available", selection.OllamaEngineAvailable,
		"runner_selection_reason", selection.Reason,
	}
	if selection.ClassicError != "" {
		attrs = append(attrs, "classic_llama_error", selection.ClassicError)
	}
	if selection.OllamaEngineError != "" {
		attrs = append(attrs, "ollama_engine_error", selection.OllamaEngineError)
	}

	slog.Info("runner selection", attrs...)
}
