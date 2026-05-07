package llm

import (
	"bytes"
	"log/slog"
	"reflect"
	"strings"
	"testing"

	"github.com/ollama/ollama/ml"
)

func resetMoEEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"OLLAMA_LOW_VRAM_OPTIMIZE",
		"OLLAMA_LOW_VRAM_VERBOSE",
		"OLLAMA_MOE_CPU_OFFLOAD",
		"OLLAMA_MOE_CPU_OFFLOAD_LAYERS",
		"OLLAMA_MOE_CPU_OFFLOAD_POLICY",
		"OLLAMA_MOE_TENSOR_OVERRIDE",
		"OLLAMA_LLAMA_ARG_PASSTHROUGH",
		"OLLAMA_NEW_ENGINE",
		"OLLAMA_FORCE_CLASSIC_LLAMA_RUNNER",
	} {
		t.Setenv(key, "")
	}
}

func captureLogs(fn func()) string {
	var b bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&b, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(prev)

	fn()
	return b.String()
}

func gpuLayersRange(start, end int) ml.GPULayersList {
	var layers []int
	for i := start; i <= end; i++ {
		layers = append(layers, i)
	}

	return ml.GPULayersList{{Layers: layers}}
}

func TestMoECPUOffloadDisabledDoesNotApplyLayers(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD", "0")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_LAYERS", "12")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_POLICY", "gpu_resident")

	decision := resolveLowVRAMMoEOptions(runnerKindClassicLlama, nil, RunnerCapabilities{SupportsCpuMoe: true, SupportsNCpuMoe: true})
	if decision.Requested {
		t.Fatalf("resolveLowVRAMMoEOptions().Requested = true, want false")
	}
	if decision.Applied {
		t.Fatalf("resolveLowVRAMMoEOptions().Applied = true, want false")
	}

	var req LoadRequest
	applyMoECPUOffloadDecision(&req, decision)
	if req.CpuMoeOffload || req.CpuMoeOffloadLayers != 0 {
		t.Fatalf("LoadRequest MoE fields = %+v, want zero values", req)
	}
}

func TestBuildMoETensorOverridePolicyFirst(t *testing.T) {
	plan := buildMoETensorOverridePlan(MoEMetadata{Architecture: "qwen3moe", BlockCount: 48}, MoEOffloadFirst, 12, true, nil, false)
	want := []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}
	if !reflect.DeepEqual(plan.SelectedLayers, want) {
		t.Fatalf("SelectedLayers = %v, want %v", plan.SelectedLayers, want)
	}
	if len(plan.TensorOverrides) != 12 || !strings.Contains(plan.TensorOverrides[0], `blk\.0\.`) || !strings.Contains(plan.TensorOverrides[11], `blk\.11\.`) {
		t.Fatalf("TensorOverrides = %v, want blk.0..blk.11", plan.TensorOverrides)
	}
}

func TestBuildMoETensorOverridePolicyLast(t *testing.T) {
	plan := buildMoETensorOverridePlan(MoEMetadata{Architecture: "qwen3moe", BlockCount: 48}, MoEOffloadLast, 12, true, nil, false)
	want := []int{36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47}
	if !reflect.DeepEqual(plan.SelectedLayers, want) {
		t.Fatalf("SelectedLayers = %v, want %v", plan.SelectedLayers, want)
	}
}

func TestBuildMoETensorOverridePolicyAll(t *testing.T) {
	plan := buildMoETensorOverridePlan(MoEMetadata{Architecture: "qwen3moe", BlockCount: 48}, MoEOffloadAll, 12, true, nil, false)
	if len(plan.SelectedLayers) != 48 || plan.SelectedLayers[0] != 0 || plan.SelectedLayers[47] != 47 {
		t.Fatalf("SelectedLayers = %v, want 0..47", plan.SelectedLayers)
	}
	if !strings.Contains(plan.Reason, "ignores requested layer count") {
		t.Fatalf("Reason = %q, want all ignores requested layer count", plan.Reason)
	}
}

func TestBuildMoETensorOverridePolicyGPUResidentLimit(t *testing.T) {
	var gpuLayers []int
	for i := 24; i <= 47; i++ {
		gpuLayers = append(gpuLayers, i)
	}

	plan := buildMoETensorOverridePlan(MoEMetadata{Architecture: "qwen3moe", BlockCount: 48}, MoEOffloadGPUResident, 12, true, gpuLayers, true)
	want := []int{36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47}
	if !reflect.DeepEqual(plan.SelectedLayers, want) {
		t.Fatalf("SelectedLayers = %v, want %v", plan.SelectedLayers, want)
	}
}

func TestBuildMoETensorOverridePolicyGPUResidentAllGPU(t *testing.T) {
	var gpuLayers []int
	for i := 24; i <= 47; i++ {
		gpuLayers = append(gpuLayers, i)
	}

	plan := buildMoETensorOverridePlan(MoEMetadata{Architecture: "qwen3moe", BlockCount: 48}, MoEOffloadGPUResident, 48, true, gpuLayers, true)
	if len(plan.SelectedLayers) != 24 || plan.SelectedLayers[0] != 24 || plan.SelectedLayers[23] != 47 {
		t.Fatalf("SelectedLayers = %v, want 24..47", plan.SelectedLayers)
	}
}

func TestBuildMoETensorOverridePolicyGPUResidentNonContiguous(t *testing.T) {
	plan := buildMoETensorOverridePlan(MoEMetadata{Architecture: "qwen3moe", BlockCount: 48}, MoEOffloadGPUResident, 2, true, []int{10, 12, 20, 21}, true)
	want := []int{20, 21}
	if !reflect.DeepEqual(plan.SelectedLayers, want) {
		t.Fatalf("SelectedLayers = %v, want %v", plan.SelectedLayers, want)
	}
}

func TestBuildMoETensorOverridePolicyLayerBounds(t *testing.T) {
	plan := buildMoETensorOverridePlan(MoEMetadata{Architecture: "qwen3moe", BlockCount: 4}, MoEOffloadFirst, 12, true, nil, false)
	if len(plan.SelectedLayers) != 4 || plan.SelectedLayers[0] != 0 || plan.SelectedLayers[3] != 3 {
		t.Fatalf("SelectedLayers = %v, want 0..3", plan.SelectedLayers)
	}

	plan = buildMoETensorOverridePlan(MoEMetadata{Architecture: "qwen3moe", BlockCount: 4}, MoEOffloadFirst, 0, true, nil, false)
	if len(plan.SelectedLayers) != 4 {
		t.Fatalf("SelectedLayers = %v, want safe full-model selection for non-positive layer request", plan.SelectedLayers)
	}
}

func TestGPUResidentMoEUpdatesLoadRequestAfterLayout(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_LOW_VRAM_VERBOSE", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_POLICY", "gpu_resident")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_LAYERS", "12")

	info := moeInfo{Architecture: "qwen3moe", BlockCount: 48}
	decision := resolveLowVRAMMoEOptionsForInfo(runnerKindClassicLlama, info, RunnerCapabilities{SupportsNCpuMoe: true})
	req := LoadRequest{}
	applyMoECPUOffloadDecision(&req, decision)
	if req.CpuMoeOffload || len(req.TensorOverrides) != 0 {
		t.Fatalf("early LoadRequest = %+v, want pending GPU-resident overrides", req)
	}

	s := &llmServer{modelPath: "qwen3-coder:30b", moeDecision: decision}
	logs := captureLogs(func() {
		s.finalizeMoECPUOffloadForGPULayers(&req, gpuLayersRange(24, 47))
	})

	if !req.CpuMoeOffload || req.CpuMoeOffloadLayers != 12 || len(req.TensorOverrides) != 12 {
		t.Fatalf("final LoadRequest = %+v, want GPU-resident MoE overrides", req)
	}
	if !strings.Contains(req.TensorOverrides[0], `blk\.36\.`) || !strings.Contains(req.TensorOverrides[11], `blk\.47\.`) {
		t.Fatalf("TensorOverrides = %v, want blk.36..blk.47", req.TensorOverrides)
	}
	for _, want := range []string{
		"policy=gpu_resident",
		"gpu_layers=24..47",
		"selected_layers=36..47",
		"tensor_override_count=12",
	} {
		if !strings.Contains(logs, want) {
			t.Fatalf("logs = %q, want %q", logs, want)
		}
	}
}

func TestGPUResidentMoEDoesNotGenerateEmptyOverridesWhenLayoutKnown(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_POLICY", "gpu_resident")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_LAYERS", "48")

	decision := resolveLowVRAMMoEOptionsForInfo(runnerKindClassicLlama, moeInfo{Architecture: "qwen3moe", BlockCount: 48}, RunnerCapabilities{SupportsNCpuMoe: true})
	req := LoadRequest{}
	s := &llmServer{modelPath: "qwen3-coder:30b", moeDecision: decision}
	s.finalizeMoECPUOffloadForGPULayers(&req, gpuLayersRange(24, 47))

	if len(req.TensorOverrides) != 24 {
		t.Fatalf("len(TensorOverrides) = %d, want all 24 GPU-resident layers", len(req.TensorOverrides))
	}
}

func TestGPUResidentMoEWithNoGPULayoutDoesNotApply(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_POLICY", "gpu_resident")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_LAYERS", "12")

	decision := resolveLowVRAMMoEOptionsForInfo(runnerKindClassicLlama, moeInfo{Architecture: "qwen3moe", BlockCount: 48}, RunnerCapabilities{SupportsNCpuMoe: true})
	req := LoadRequest{}
	s := &llmServer{modelPath: "qwen3-coder:30b", moeDecision: decision}
	s.finalizeMoECPUOffloadForGPULayers(&req, nil)

	if req.CpuMoeOffload || len(req.TensorOverrides) != 0 {
		t.Fatalf("LoadRequest = %+v, want no overrides without GPU-resident layers", req)
	}
	if s.moeDecision.Reason != "no GPU-resident MoE layers selected" {
		t.Fatalf("Reason = %q, want no GPU-resident layers", s.moeDecision.Reason)
	}
}

func TestMoECPUOffloadUnsupportedLogsDecisionReason(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_LOW_VRAM_VERBOSE", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_LAYERS", "12")

	var decision moeCPUOffloadDecision
	logs := captureLogs(func() {
		decision = resolveLowVRAMMoEOptions(runnerKindClassicLlama, nil, RunnerCapabilities{})
		logMoECPUOffloadDecision("qwen3.6:35b", decision)
	})

	if !decision.Requested {
		t.Fatalf("resolveLowVRAMMoEOptions().Requested = false, want true")
	}
	if decision.Applied {
		t.Fatalf("resolveLowVRAMMoEOptions().Applied = true, want false")
	}
	if decision.Reason != "bundled runner does not expose MoE expert CPU placement" {
		t.Fatalf("reason = %q, want unsupported runner reason", decision.Reason)
	}
	for _, want := range []string{
		"moe_cpu_offload decision",
		"runner_kind=classic_llama",
		"requested=true",
		"supported=false",
		"applied=false",
		`reason="bundled runner does not expose MoE expert CPU placement"`,
	} {
		if !strings.Contains(logs, want) {
			t.Fatalf("logs = %q, want %q", logs, want)
		}
	}
}

func TestMoECPUOffloadSupportedMapsToLoadRequest(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_LOW_VRAM_VERBOSE", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD", "1")

	decision := resolveLowVRAMMoEOptions(runnerKindClassicLlama, nil, RunnerCapabilities{SupportsCpuMoe: true})
	var req LoadRequest
	applyMoECPUOffloadDecision(&req, decision)

	if !decision.Requested {
		t.Fatalf("Requested = false, want true")
	}
	if !req.CpuMoeOffload {
		t.Fatalf("CpuMoeOffload = false, want true")
	}
	if req.CpuMoeOffloadLayers != 0 {
		t.Fatalf("CpuMoeOffloadLayers = %d, want 0", req.CpuMoeOffloadLayers)
	}
	if decision.AppliedMode != "cpu_moe" {
		t.Fatalf("AppliedMode = %q, want cpu_moe", decision.AppliedMode)
	}
	if len(req.TensorOverrides) == 0 {
		t.Fatalf("TensorOverrides empty, want default MoE CPU override")
	}
}

func TestMoECPUOffloadLayersMapToLoadRequest(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_LAYERS", "12")

	decision := resolveLowVRAMMoEOptions(runnerKindClassicLlama, nil, RunnerCapabilities{SupportsNCpuMoe: true})
	var req LoadRequest
	applyMoECPUOffloadDecision(&req, decision)

	if !req.CpuMoeOffload {
		t.Fatalf("CpuMoeOffload = false, want true")
	}
	if req.CpuMoeOffloadLayers != 12 {
		t.Fatalf("CpuMoeOffloadLayers = %d, want 12", req.CpuMoeOffloadLayers)
	}
	if decision.AppliedMode != "n_cpu_moe" {
		t.Fatalf("AppliedMode = %q, want n_cpu_moe", decision.AppliedMode)
	}
	if len(req.TensorOverrides) != 12 {
		t.Fatalf("len(TensorOverrides) = %d, want 12", len(req.TensorOverrides))
	}
}

func TestMoETensorOverrideMapsToLoadRequest(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD", "1")
	t.Setenv("OLLAMA_MOE_TENSOR_OVERRIDE", ".ffn_.*_exps.=CPU")

	decision := resolveLowVRAMMoEOptions(runnerKindClassicLlama, nil, RunnerCapabilities{SupportsCpuMoe: true, SupportsTensorOverride: true})
	var req LoadRequest
	applyMoECPUOffloadDecision(&req, decision)

	if !slicesContains(req.TensorOverrides, ".ffn_.*_exps.") {
		t.Fatalf("TensorOverrides = %v, want custom override", req.TensorOverrides)
	}
}

func TestMoETensorOverrideUnsupportedWarnsWithoutCrash(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_LOW_VRAM_VERBOSE", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD", "1")
	t.Setenv("OLLAMA_MOE_TENSOR_OVERRIDE", ".ffn_.*_exps.=CPU")

	var decision moeCPUOffloadDecision
	logs := captureLogs(func() {
		decision = resolveLowVRAMMoEOptions(runnerKindClassicLlama, nil, RunnerCapabilities{SupportsCpuMoe: true})
		logMoECPUOffloadDecision("qwen3.6:35b", decision)
	})

	if !decision.Applied {
		t.Fatalf("MoE CPU offload should still apply when only tensor override support is missing")
	}
	if decision.TensorOverrideApplied {
		t.Fatalf("TensorOverrideApplied = true, want false")
	}
	if !strings.Contains(logs, "MoE tensor override requested but unsupported") {
		t.Fatalf("logs = %q, want tensor override warning", logs)
	}
}

func TestMoEDetectionTrueFromMetadata(t *testing.T) {
	for _, architecture := range []string{"qwen35moe", "qwen3moe"} {
		t.Run(architecture, func(t *testing.T) {
			info := detectMoEFromMetadata(moeMetadata{
				Available:    true,
				Architecture: architecture,
				Values: map[string]any{
					architecture + ".expert_count":      uint32(128),
					architecture + ".expert_used_count": uint32(8),
				},
				TensorNames: []string{"blk.0.ffn_gate_exps.weight"},
			})

			if info.Detected != moeTrue {
				t.Fatalf("detectMoEFromMetadata().Detected = %s, want true", info.Detected)
			}
			if info.ExpertCount != 128 {
				t.Fatalf("detectMoEFromMetadata().ExpertCount = %d, want 128", info.ExpertCount)
			}
			if info.ExpertsUsed != 8 {
				t.Fatalf("detectMoEFromMetadata().ExpertsUsed = %d, want 8", info.ExpertsUsed)
			}
		})
	}
}

func TestMoEDetectionDenseMetadataFalse(t *testing.T) {
	info := detectMoEFromMetadata(moeMetadata{
		Available:    true,
		Architecture: "llama",
		Values:       map[string]any{"llama.block_count": uint32(32)},
		TensorNames:  []string{"blk.0.ffn_gate.weight", "blk.0.ffn_up.weight"},
	})
	if info.Detected != moeFalse {
		t.Fatalf("detectMoEFromMetadata().Detected = %s, want false", info.Detected)
	}
}

func TestMoEDetectionUnknownWhenMetadataUnavailable(t *testing.T) {
	info := detectMoEFromMetadata(moeMetadata{})
	if info.Detected != moeUnknown {
		t.Fatalf("detectMoEFromMetadata().Detected = %s, want unknown", info.Detected)
	}
}

func TestClassicRunnerCapabilitiesSupportTensorOverrides(t *testing.T) {
	caps := LlamaRunnerCapabilities()
	if !caps.SupportsCpuMoe || !caps.SupportsNCpuMoe || !caps.SupportsTensorOverride {
		t.Fatalf("LlamaRunnerCapabilities() = %+v, want internal MoE tensor override support", caps)
	}
}

func TestMoECPUOffloadQwen35MetadataAppliesTensorOverrides(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_LAYERS", "12")

	info := detectMoEFromMetadata(moeMetadata{
		Available:    true,
		Architecture: "qwen35moe",
		Values:       map[string]any{"qwen35moe.expert_count": uint32(128)},
		TensorNames:  []string{"blk.0.ffn_gate_exps.weight"},
	})
	decision := resolveLowVRAMMoEOptionsForInfo(runnerKindClassicLlama, info, RunnerCapabilities{SupportsNCpuMoe: true})
	var req LoadRequest
	applyMoECPUOffloadDecision(&req, decision)

	if !decision.Requested || !decision.Supported || !decision.Applied {
		t.Fatalf("decision = %+v, want requested/supported/applied true", decision)
	}
	if req.CpuMoeOffload != true || req.CpuMoeOffloadLayers != 12 || len(req.TensorOverrides) == 0 {
		t.Fatalf("LoadRequest = %+v, want MoE offload fields and tensor overrides", req)
	}
}

func TestMoEOptionsDoNotApplyToNonLlamaRunner(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_LOW_VRAM_VERBOSE", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_LAYERS", "12")
	t.Setenv("OLLAMA_MOE_TENSOR_OVERRIDE", ".ffn_.*_exps.=CPU")

	decision := resolveLowVRAMMoEOptions(runnerKindOllamaEngine, nil, RunnerCapabilities{
		SupportsCpuMoe:         true,
		SupportsNCpuMoe:        true,
		SupportsTensorOverride: true,
	})
	if !decision.Requested {
		t.Fatalf("resolveLowVRAMMoEOptions().Requested = false, want true")
	}
	if decision.Applied {
		t.Fatalf("resolveLowVRAMMoEOptions().Applied = true, want false for non-llama runner")
	}
	if decision.Supported {
		t.Fatalf("resolveLowVRAMMoEOptions().Supported = true, want false for active Ollama engine runner")
	}
	if decision.Reason == "" {
		t.Fatalf("resolveLowVRAMMoEOptions().Reason empty, want unsupported active runner reason")
	}

	logs := captureLogs(func() {
		logMoECPUOffloadDecision("qwen3.6:35b", decision)
	})
	if !strings.Contains(logs, "runner_kind=ollama_engine") {
		t.Fatalf("logs = %q, want runner_kind=ollama_engine", logs)
	}
}

func TestOllamaEngineStartupArgDoesNotDisableClassicCapability(t *testing.T) {
	args := []string{"runner", "--ollama-engine", "--port", "12345"}
	caps := LlamaRunnerCapabilities()
	if !slicesContains(args, "--ollama-engine") {
		t.Fatal("test setup missing --ollama-engine")
	}
	if !caps.SupportsCpuMoe || !caps.SupportsNCpuMoe || !caps.SupportsTensorOverride {
		t.Fatalf("LlamaRunnerCapabilities() = %+v, want classic tensor override support independent of startup args", caps)
	}
}

func TestLowVRAMLlamaRunnerArgsDoNotAppendMoEFlags(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD", "1")
	t.Setenv("OLLAMA_MOE_CPU_OFFLOAD_LAYERS", "12")

	got := buildLowVRAMLlamaRunnerArgs(false, RunnerCapabilities{
		SupportsCpuMoe:  true,
		SupportsNCpuMoe: true,
	})
	if len(got) != 0 {
		t.Fatalf("buildLowVRAMLlamaRunnerArgs() = %v, want no CLI args for internal MoE options", got)
	}
}

func slicesContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestLowVRAMLlamaArgPassthroughDisabledByDefault(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")

	got := buildLowVRAMLlamaRunnerArgs(false, RunnerCapabilities{SupportsArgPassthrough: true})
	if len(got) != 0 {
		t.Fatalf("buildLowVRAMLlamaRunnerArgs() = %v, want no passthrough args by default", got)
	}
}

func TestLowVRAMLlamaArgPassthroughRequiresRunnerSupport(t *testing.T) {
	resetMoEEnv(t)
	t.Setenv("OLLAMA_LOW_VRAM_OPTIMIZE", "1")
	t.Setenv("OLLAMA_LLAMA_ARG_PASSTHROUGH", `--n-cpu-moe 12`)

	var got []string
	logs := captureLogs(func() {
		got = buildLowVRAMLlamaRunnerArgs(false, RunnerCapabilities{})
	})
	if len(got) != 0 {
		t.Fatalf("buildLowVRAMLlamaRunnerArgs() = %v, want no args without passthrough support", got)
	}
	if !strings.Contains(logs, "raw llama.cpp arg passthrough requested but this runner does not expose passthrough support") {
		t.Fatalf("logs = %q, want unsupported passthrough warning", logs)
	}
}

func TestSplitLlamaArgPassthroughSplitsQuotedArgs(t *testing.T) {
	got, err := splitLlamaArgPassthrough(`--n-cpu-moe 12 --override-tensor ".ffn_.*_exps.=CPU" --label 'two words'`)
	if err != nil {
		t.Fatal(err)
	}

	want := []string{"--n-cpu-moe", "12", "--override-tensor", ".ffn_.*_exps.=CPU", "--label", "two words"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("splitLlamaArgPassthrough() = %v, want %v", got, want)
	}
}

func TestLlamaArgPassthroughTreatsShellMetacharactersAsArgs(t *testing.T) {
	got, err := splitLlamaArgPassthrough(`--flag value ; cmd /c echo nope`)
	if err != nil {
		t.Fatal(err)
	}

	want := []string{"--flag", "value", ";", "cmd", "/c", "echo", "nope"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("splitLlamaArgPassthrough() = %v, want %v", got, want)
	}
}
