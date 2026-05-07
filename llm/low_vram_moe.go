package llm

import (
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"github.com/ollama/ollama/envconfig"
	"github.com/ollama/ollama/fs/ggml"
	llamabackend "github.com/ollama/ollama/llama"
	"github.com/ollama/ollama/ml"
)

type RunnerCapabilities struct {
	SupportsFlashAttention bool
	SupportsKVCacheType    bool
	SupportsCpuMoe         bool
	SupportsNCpuMoe        bool
	SupportsTensorOverride bool
	SupportsArgPassthrough bool
}

type moeDetection int

const (
	moeUnknown moeDetection = iota
	moeFalse
	moeTrue
)

type runnerKind string

const (
	runnerKindClassicLlama runnerKind = "classic_llama"
	runnerKindOllamaEngine runnerKind = "ollama_engine"
)

type MoEOffloadPolicy string

const (
	MoEOffloadFirst       MoEOffloadPolicy = "first"
	MoEOffloadLast        MoEOffloadPolicy = "last"
	MoEOffloadAll         MoEOffloadPolicy = "all"
	MoEOffloadGPUResident MoEOffloadPolicy = "gpu_resident"
)

type MoEMetadata struct {
	Architecture string
	BlockCount   int
}

func (d moeDetection) String() string {
	switch d {
	case moeTrue:
		return "true"
	case moeFalse:
		return "false"
	default:
		return "unknown"
	}
}

type moeInfo struct {
	Detected     moeDetection
	Architecture string
	BlockCount   int
	ExpertCount  uint64
	ExpertsUsed  uint64
	Indicators   []string
}

type moeMetadata struct {
	Available    bool
	Architecture string
	Values       map[string]any
	TensorNames  []string
}

type moeCPUOffloadDecision struct {
	Info                    moeInfo
	RunnerKind              runnerKind
	Policy                  MoEOffloadPolicy
	Requested               bool
	RequestedLayers         int
	RequestedLayersSet      bool
	BlockCount              int
	GPULayersKnown          bool
	GPULayers               []int
	SelectedLayers          []int
	Supported               bool
	Applied                 bool
	AppliedMode             string
	AppliedLayers           int
	Reason                  string
	TensorOverrideRequested bool
	TensorOverrideApplied   bool
	TensorOverrideReason    string
	CustomTensorOverride    string
	TensorOverrides         []string
	TensorOverrideCount     int
	ResolvedAfterGPULayout  bool
}

func LlamaRunnerCapabilities() RunnerCapabilities {
	tensorBufferOverrides := llamabackend.SupportsTensorBufferOverrides()

	// The bundled runner bypasses llama.cpp's CLI parser. MoE support is exposed
	// through llama_model_params.tensor_buft_overrides, which the model loader
	// applies during tensor placement.
	return RunnerCapabilities{
		SupportsFlashAttention: true,
		SupportsKVCacheType:    true,
		SupportsCpuMoe:         tensorBufferOverrides,
		SupportsNCpuMoe:        tensorBufferOverrides,
		SupportsTensorOverride: tensorBufferOverrides,
	}
}

func resolveLowVRAMMoEOptions(kind runnerKind, f *ggml.GGML, caps RunnerCapabilities) moeCPUOffloadDecision {
	return resolveLowVRAMMoEOptionsForInfo(kind, detectMoEModel(f), caps)
}

func resolveLowVRAMMoEOptionsForInfo(kind runnerKind, info moeInfo, caps RunnerCapabilities) moeCPUOffloadDecision {
	decision := moeCPUOffloadDecision{
		Info:       info,
		RunnerKind: kind,
		Policy:     MoEOffloadPolicy(envconfig.MoECPUOffloadPolicy()),
		BlockCount: info.BlockCount,
		Requested:  envconfig.MoECPUOffload(),
	}
	if !envconfig.LowVRAMEnabled() {
		if decision.Requested {
			decision.Reason = "low-VRAM mode is disabled"
		}
		return decision
	}

	if !decision.Requested {
		return decision
	}

	decision.RequestedLayers, decision.RequestedLayersSet = envconfig.MoECPUOffloadLayers()
	switch {
	case kind != runnerKindClassicLlama:
		decision.Supported = false
		decision.Reason = "active Ollama engine runner does not expose MoE expert CPU placement"
	case decision.RequestedLayersSet:
		decision.Supported = caps.SupportsNCpuMoe
	default:
		decision.Supported = caps.SupportsCpuMoe
	}

	if !decision.Supported {
		if decision.Reason == "" {
			decision.Reason = "bundled runner does not expose MoE expert CPU placement"
		}
		return decision
	}

	if decision.RequestedLayersSet {
		decision.AppliedMode = "n_cpu_moe"
	} else {
		decision.AppliedMode = "cpu_moe"
	}

	updateMoECPUOffloadDecisionPlan(&decision, nil, false)

	tensorOverride := strings.TrimSpace(envconfig.MoETensorOverride())
	if tensorOverride != "" {
		decision.TensorOverrideRequested = true
		pattern, reason, ok := parseTensorOverridePattern(tensorOverride)
		switch {
		case !ok:
			decision.TensorOverrideReason = reason
		case !caps.SupportsTensorOverride:
			decision.TensorOverrideReason = "bundled runner does not expose tensor buffer overrides"
		default:
			decision.TensorOverrideApplied = true
			decision.CustomTensorOverride = pattern
			decision.TensorOverrides = append(decision.TensorOverrides, pattern)
		}
	}
	decision.TensorOverrideCount = len(decision.TensorOverrides)
	decision.Applied = len(decision.TensorOverrides) > 0

	return decision
}

func updateMoECPUOffloadDecisionPlan(decision *moeCPUOffloadDecision, gpuLayers []int, gpuLayersKnown bool) {
	plan := buildMoETensorOverridePlan(
		MoEMetadata{
			Architecture: decision.Info.Architecture,
			BlockCount:   decision.Info.BlockCount,
		},
		decision.Policy,
		decision.RequestedLayers,
		decision.RequestedLayersSet,
		gpuLayers,
		gpuLayersKnown,
	)

	decision.BlockCount = plan.BlockCount
	decision.GPULayersKnown = gpuLayersKnown
	decision.GPULayers = append([]int(nil), plan.GPULayers...)
	decision.SelectedLayers = append([]int(nil), plan.SelectedLayers...)
	decision.TensorOverrides = append([]string(nil), plan.TensorOverrides...)
	if decision.TensorOverrideApplied && decision.CustomTensorOverride != "" {
		decision.TensorOverrides = append(decision.TensorOverrides, decision.CustomTensorOverride)
	}
	decision.TensorOverrideCount = len(decision.TensorOverrides)
	if plan.Reason != "" {
		decision.Reason = plan.Reason
	} else if decision.Supported {
		decision.Reason = ""
	}
	if decision.RequestedLayersSet || len(plan.SelectedLayers) > 0 {
		decision.AppliedLayers = len(plan.SelectedLayers)
	} else {
		decision.AppliedLayers = 0
	}
	decision.Applied = decision.Supported && len(decision.TensorOverrides) > 0
}

type moeTensorOverridePlan struct {
	Policy          MoEOffloadPolicy
	BlockCount      int
	GPULayers       []int
	SelectedLayers  []int
	TensorOverrides []string
	Reason          string
}

func BuildMoETensorOverrides(meta MoEMetadata, policy MoEOffloadPolicy, requestedLayers int, gpuLayers []int) []string {
	return buildMoETensorOverridePlan(meta, policy, requestedLayers, requestedLayers > 0, gpuLayers, true).TensorOverrides
}

func buildMoETensorOverridePlan(meta MoEMetadata, policy MoEOffloadPolicy, requestedLayers int, requestedLayersSet bool, gpuLayers []int, gpuLayersKnown bool) moeTensorOverridePlan {
	plan := moeTensorOverridePlan{
		Policy:     policy,
		BlockCount: meta.BlockCount,
		GPULayers:  normalizeLayerList(gpuLayers, meta.BlockCount),
	}

	var selected []int
	switch policy {
	case MoEOffloadLast:
		selected = selectLastMoELayers(meta.BlockCount, requestedLayers, requestedLayersSet)
		if requestedLayersSet && meta.BlockCount <= 0 {
			plan.Reason = "block count unavailable for last policy, using first policy"
		}
	case MoEOffloadAll:
		selected = selectAllMoELayers(meta.BlockCount)
		if requestedLayersSet {
			plan.Reason = "policy all ignores requested layer count"
		}
	case MoEOffloadGPUResident:
		if !gpuLayersKnown {
			plan.Reason = "waiting for GPU layer layout"
			return plan
		}
		selected = selectGPUResidentMoELayers(plan.GPULayers, requestedLayers, requestedLayersSet)
		if len(selected) == 0 {
			plan.Reason = "no GPU-resident MoE layers selected"
		}
	default:
		selected = selectFirstMoELayers(meta.BlockCount, requestedLayers, requestedLayersSet)
	}

	plan.SelectedLayers = selected
	plan.TensorOverrides = tensorOverridesForSelectedLayers(selected, policy, requestedLayersSet, meta.BlockCount)
	return plan
}

func selectFirstMoELayers(blockCount, requestedLayers int, requestedLayersSet bool) []int {
	if !requestedLayersSet || requestedLayers <= 0 {
		if blockCount <= 0 {
			return nil
		}
		requestedLayers = blockCount
	} else if blockCount > 0 {
		requestedLayers = min(requestedLayers, blockCount)
	}

	layers := make([]int, 0, max(0, requestedLayers))
	for i := range requestedLayers {
		layers = append(layers, i)
	}

	return layers
}

func selectLastMoELayers(blockCount, requestedLayers int, requestedLayersSet bool) []int {
	if blockCount <= 0 {
		return selectFirstMoELayers(blockCount, requestedLayers, requestedLayersSet)
	}

	if !requestedLayersSet || requestedLayers <= 0 || requestedLayers > blockCount {
		requestedLayers = blockCount
	}

	layers := make([]int, 0, requestedLayers)
	for i := blockCount - requestedLayers; i < blockCount; i++ {
		layers = append(layers, i)
	}

	return layers
}

func selectAllMoELayers(blockCount int) []int {
	if blockCount <= 0 {
		return nil
	}

	layers := make([]int, 0, blockCount)
	for i := range blockCount {
		layers = append(layers, i)
	}

	return layers
}

func selectGPUResidentMoELayers(gpuLayers []int, requestedLayers int, requestedLayersSet bool) []int {
	gpuLayers = normalizeLayerList(gpuLayers, 0)
	if len(gpuLayers) == 0 {
		return nil
	}

	if requestedLayersSet && requestedLayers > 0 && requestedLayers < len(gpuLayers) {
		gpuLayers = append([]int(nil), gpuLayers[len(gpuLayers)-requestedLayers:]...)
	}

	return gpuLayers
}

func tensorOverridesForSelectedLayers(selected []int, policy MoEOffloadPolicy, requestedLayersSet bool, blockCount int) []string {
	if len(selected) == 0 {
		if !requestedLayersSet && policy != MoEOffloadGPUResident {
			return []string{"blk\\.\\d+\\.ffn_(up|down|gate)_(ch|)exps"}
		}
		if policy == MoEOffloadAll && blockCount <= 0 {
			return []string{"blk\\.\\d+\\.ffn_(up|down|gate)_(ch|)exps"}
		}
		return nil
	}

	patterns := make([]string, 0, len(selected))
	for _, layer := range selected {
		patterns = append(patterns, fmt.Sprintf("blk\\.%d\\.ffn_(up|down|gate)_(ch|)exps", layer))
	}
	return patterns
}

func normalizeLayerList(layers []int, blockCount int) []int {
	seen := make(map[int]struct{}, len(layers))
	out := make([]int, 0, len(layers))
	for _, layer := range layers {
		if layer < 0 {
			continue
		}
		if blockCount > 0 && layer >= blockCount {
			continue
		}
		if _, ok := seen[layer]; ok {
			continue
		}
		seen[layer] = struct{}{}
		out = append(out, layer)
	}

	sort.Ints(out)
	return out
}

func applyMoECPUOffloadDecision(req *LoadRequest, decision moeCPUOffloadDecision) {
	req.CpuMoeOffload = false
	req.CpuMoeOffloadLayers = 0
	req.TensorOverrides = nil
	if !decision.Applied {
		return
	}

	req.CpuMoeOffload = true
	req.CpuMoeOffloadLayers = decision.AppliedLayers
	req.TensorOverrides = append([]string(nil), decision.TensorOverrides...)
}

func logMoECPUOffloadDecision(model string, decision moeCPUOffloadDecision) {
	if decision.Requested && !decision.Supported && decision.Reason != "" {
		slog.Warn("MoE CPU offload requested but unsupported", "reason", decision.Reason)
	}
	if decision.TensorOverrideRequested && !decision.TensorOverrideApplied && decision.TensorOverrideReason != "" {
		slog.Warn("MoE tensor override requested but unsupported", "reason", decision.TensorOverrideReason)
	}
	if !envconfig.LowVRAMEnabled() || !envconfig.LowVRAMVerbose() {
		return
	}

	attrs := []any{
		"model", model,
		"runner_kind", decision.RunnerKind,
		"architecture", decision.Info.Architecture,
		"moe_detected", decision.Info.Detected.String(),
		"expert_count", decision.Info.ExpertCount,
		"experts_used", decision.Info.ExpertsUsed,
		"policy", decision.Policy,
		"requested", decision.Requested,
		"supported", decision.Supported,
		"applied", decision.Applied,
		"applied_mode", decision.AppliedMode,
		"applied_layers", decision.AppliedLayers,
		"block_count", decision.BlockCount,
		"gpu_layers_known", decision.GPULayersKnown,
		"gpu_layers", compactLayerList(decision.GPULayers),
		"selected_layers", compactLayerList(decision.SelectedLayers),
		"tensor_override_count", decision.TensorOverrideCount,
		"resolved_after_gpu_layout", decision.ResolvedAfterGPULayout,
		"tensor_override_requested", decision.TensorOverrideRequested,
		"tensor_override_applied", decision.TensorOverrideApplied,
	}
	if decision.RequestedLayersSet {
		attrs = append(attrs, "requested_layers", decision.RequestedLayers)
	}
	if decision.Reason != "" {
		attrs = append(attrs, "reason", decision.Reason)
	}
	if decision.TensorOverrideReason != "" {
		attrs = append(attrs, "tensor_override_reason", decision.TensorOverrideReason)
	}
	if len(decision.TensorOverrides) > 0 {
		attrs = append(attrs, "tensor_overrides", decision.TensorOverrides)
	}
	if len(decision.Info.Indicators) > 0 {
		attrs = append(attrs, "indicators", decision.Info.Indicators)
	}

	slog.Info("moe_cpu_offload decision", attrs...)
}

func compactLayerList(layers []int) string {
	layers = normalizeLayerList(layers, 0)
	if len(layers) == 0 {
		return ""
	}

	var parts []string
	start := layers[0]
	prev := layers[0]
	for _, layer := range layers[1:] {
		if layer == prev+1 {
			prev = layer
			continue
		}
		parts = append(parts, compactLayerRange(start, prev))
		start = layer
		prev = layer
	}
	parts = append(parts, compactLayerRange(start, prev))

	return strings.Join(parts, ",")
}

func compactLayerRange(start, end int) string {
	if start == end {
		return fmt.Sprintf("%d", start)
	}

	return fmt.Sprintf("%d..%d", start, end)
}

func (s *llmServer) finalizeMoECPUOffloadForGPULayers(req *LoadRequest, gpuLayers ml.GPULayersList) {
	if !s.moeDecision.Requested || !s.moeDecision.Supported {
		return
	}

	updateMoECPUOffloadDecisionPlan(&s.moeDecision, gpuLayerListLayers(gpuLayers), true)
	s.moeDecision.ResolvedAfterGPULayout = true
	applyMoECPUOffloadDecision(req, s.moeDecision)
	logMoECPUOffloadDecision(s.modelPath, s.moeDecision)

	if s.moeDecision.Applied && envconfig.LowVRAMEnabled() && envconfig.LowVRAMVerbose() {
		slog.Info("moe tensor overrides are applied at runner load; scheduler layer selection does not account for tensor-level expert placement",
			"policy", s.moeDecision.Policy,
			"gpu_layers", compactLayerList(s.moeDecision.GPULayers),
			"selected_layers", compactLayerList(s.moeDecision.SelectedLayers),
			"tensor_override_count", s.moeDecision.TensorOverrideCount)
	}
}

func gpuLayerListLayers(gpuLayers ml.GPULayersList) []int {
	var layers []int
	for _, gl := range gpuLayers {
		layers = append(layers, gl.Layers...)
	}

	return normalizeLayerList(layers, 0)
}

func (s *llamaServer) moeTensorOverrideWeightsByLayer() map[int]uint64 {
	if !s.moeDecision.Applied || len(s.moeDecision.TensorOverrides) == 0 {
		return nil
	}

	return moeTensorOverrideWeightsByLayer(s.ggml, s.moeDecision.TensorOverrides)
}

func moeTensorOverrideWeightsByLayer(f *ggml.GGML, patterns []string) map[int]uint64 {
	if f == nil || len(patterns) == 0 {
		return nil
	}

	regexps := make([]*regexp.Regexp, 0, len(patterns))
	for _, pattern := range patterns {
		re, err := regexp.Compile(pattern)
		if err != nil {
			slog.Debug("unable to account for MoE tensor override in memory estimate", "pattern", pattern, "error", err)
			continue
		}
		regexps = append(regexps, re)
	}
	if len(regexps) == 0 {
		return nil
	}

	weights := make(map[int]uint64)
	counted := make(map[string]struct{})
	for _, tensor := range f.Tensors().Items() {
		if _, ok := counted[tensor.Name]; ok {
			continue
		}

		for _, re := range regexps {
			if !re.MatchString(tensor.Name) {
				continue
			}

			layer, ok := tensorBlockIndex(tensor.Name)
			if !ok {
				break
			}

			weights[layer] += tensor.Size()
			counted[tensor.Name] = struct{}{}
			break
		}
	}

	return weights
}

func tensorBlockIndex(name string) (int, bool) {
	var layer int
	if _, err := fmt.Sscanf(name, "blk.%d.", &layer); err != nil {
		return 0, false
	}

	return layer, true
}

func parseTensorOverridePattern(raw string) (pattern, reason string, ok bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.ContainsAny(raw, "\x00\r\n") {
		return "", "empty or invalid tensor override", false
	}

	pattern, target, found := strings.Cut(raw, "=")
	if !found {
		return "", "tensor override must use PATTERN=CPU syntax", false
	}

	pattern = strings.TrimSpace(pattern)
	target = strings.TrimSpace(target)
	if pattern == "" {
		return "", "tensor override pattern is empty", false
	}
	if !strings.EqualFold(target, "CPU") {
		return "", "only CPU tensor overrides are supported", false
	}

	return pattern, "", true
}

func buildLowVRAMLlamaRunnerArgs(ollamaEngine bool, caps RunnerCapabilities) []string {
	if ollamaEngine || !envconfig.LowVRAMEnabled() {
		return nil
	}

	passthrough := strings.TrimSpace(envconfig.LlamaArgPassthrough())
	if passthrough == "" {
		return nil
	}
	if !caps.SupportsArgPassthrough {
		slog.Warn("raw llama.cpp arg passthrough requested but this runner does not expose passthrough support")
		return nil
	}

	passthroughArgs, err := splitLlamaArgPassthrough(passthrough)
	if err != nil {
		slog.Warn("invalid raw llama.cpp arg passthrough, ignoring", "error", err)
		return nil
	}
	if len(passthroughArgs) == 0 {
		return nil
	}

	slog.Warn("Using raw llama.cpp arg passthrough; this is experimental and may break model loading.")
	if envconfig.LowVRAMVerbose() {
		slog.Info("low_vram llama.cpp arg passthrough", "args", passthroughArgs)
	}

	return passthroughArgs
}

func detectMoEModel(f *ggml.GGML) moeInfo {
	if f == nil {
		return moeInfo{Detected: moeUnknown}
	}

	kv := f.KV()
	meta := moeMetadata{
		Available:    true,
		Architecture: kv.Architecture(),
		Values:       make(map[string]any, kv.Len()),
	}
	for key := range kv.Keys() {
		meta.Values[key] = kv.Value(key)
	}
	for _, tensor := range f.Tensors().Items() {
		meta.TensorNames = append(meta.TensorNames, tensor.Name)
	}

	return detectMoEFromMetadata(meta)
}

func detectMoEFromMetadata(meta moeMetadata) moeInfo {
	info := moeInfo{
		Detected:     moeUnknown,
		Architecture: meta.Architecture,
	}
	if !meta.Available {
		return info
	}

	info.Detected = moeFalse
	arch := strings.ToLower(meta.Architecture)
	if strings.Contains(arch, "moe") {
		info.Detected = moeTrue
		info.Indicators = appendIndicator(info.Indicators, "architecture")
	}

	for key, value := range meta.Values {
		lowerKey := strings.ToLower(key)
		if strings.Contains(lowerKey, "expert_count") || strings.Contains(lowerKey, "n_expert") {
			if strings.Contains(lowerKey, "used") {
				if n, ok := numericMetadataValue(value); ok {
					info.ExpertsUsed = max(info.ExpertsUsed, n)
				}
			} else if n, ok := numericMetadataValue(value); ok {
				info.ExpertCount = max(info.ExpertCount, n)
				if n > 0 {
					info.Detected = moeTrue
					info.Indicators = appendIndicator(info.Indicators, key)
				}
			}
			continue
		}

		if strings.Contains(lowerKey, "experts_used") || strings.Contains(lowerKey, "expert_used") {
			if n, ok := numericMetadataValue(value); ok {
				info.ExpertsUsed = max(info.ExpertsUsed, n)
				if n > 0 {
					info.Detected = moeTrue
					info.Indicators = appendIndicator(info.Indicators, key)
				}
			}
			continue
		}

		if strings.Contains(lowerKey, "moe") {
			info.Detected = moeTrue
			info.Indicators = appendIndicator(info.Indicators, key)
		}

		if strings.Contains(lowerKey, "block_count") {
			if n, ok := numericMetadataValue(value); ok {
				info.BlockCount = int(n)
			}
		}
	}

	for _, name := range meta.TensorNames {
		lowerName := strings.ToLower(name)
		if tensorNameLooksMoE(lowerName) {
			info.Detected = moeTrue
			info.Indicators = appendIndicator(info.Indicators, name)
		}
	}

	return info
}

func tensorNameLooksMoE(name string) bool {
	for _, marker := range []string{
		"experts",
		"expert",
		"moe",
		"ffn_exps",
		"ffn_gate_exps",
		"ffn_up_exps",
		"ffn_down_exps",
		"feed_forward.experts",
		"router",
		"gate_exps",
	} {
		if strings.Contains(name, marker) {
			return true
		}
	}

	return false
}

func numericMetadataValue(v any) (uint64, bool) {
	switch n := v.(type) {
	case uint:
		return uint64(n), true
	case uint8:
		return uint64(n), true
	case uint16:
		return uint64(n), true
	case uint32:
		return uint64(n), true
	case uint64:
		return n, true
	case int:
		return uint64(n), n >= 0
	case int8:
		return uint64(n), n >= 0
	case int16:
		return uint64(n), n >= 0
	case int32:
		return uint64(n), n >= 0
	case int64:
		return uint64(n), n >= 0
	default:
		return 0, false
	}
}

func appendIndicator(indicators []string, indicator string) []string {
	for _, existing := range indicators {
		if existing == indicator {
			return indicators
		}
	}

	return append(indicators, indicator)
}

func splitLlamaArgPassthrough(raw string) ([]string, error) {
	var args []string
	var b strings.Builder
	var quote rune
	inArg := false

	flush := func() {
		if inArg || b.Len() > 0 {
			args = append(args, b.String())
			b.Reset()
			inArg = false
		}
	}

	for _, r := range raw {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				b.WriteRune(r)
			}
			inArg = true
		case r == '"' || r == '\'':
			quote = r
			inArg = true
		case unicode.IsSpace(r):
			flush()
		default:
			b.WriteRune(r)
			inArg = true
		}
	}

	if quote != 0 {
		return nil, fmt.Errorf("unterminated quote")
	}

	flush()
	return args, nil
}
