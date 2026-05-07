package envconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Host returns the scheme and host. Host can be configured via the OLLAMA_HOST environment variable.
// Default is scheme "http" and host "127.0.0.1:11434"
func Host() *url.URL {
	defaultPort := "11434"

	s := strings.TrimSpace(Var("OLLAMA_HOST"))
	scheme, hostport, ok := strings.Cut(s, "://")
	switch {
	case !ok:
		scheme, hostport = "http", s
		if s == "ollama.com" {
			scheme, hostport = "https", "ollama.com:443"
		}
	case scheme == "http":
		defaultPort = "80"
	case scheme == "https":
		defaultPort = "443"
	}

	hostport, path, _ := strings.Cut(hostport, "/")
	host, port, err := net.SplitHostPort(hostport)
	if err != nil {
		host, port = "127.0.0.1", defaultPort
		if ip := net.ParseIP(strings.Trim(hostport, "[]")); ip != nil {
			host = ip.String()
		} else if hostport != "" {
			host = hostport
		}
	}

	if n, err := strconv.ParseInt(port, 10, 32); err != nil || n > 65535 || n < 0 {
		slog.Warn("invalid port, using default", "port", port, "default", defaultPort)
		port = defaultPort
	}

	return &url.URL{
		Scheme: scheme,
		Host:   net.JoinHostPort(host, port),
		Path:   path,
	}
}

// ConnectableHost returns Host() with unspecified bind addresses (0.0.0.0, ::)
// replaced by the corresponding loopback address (127.0.0.1, ::1).
// Unspecified addresses are valid for binding a server socket but not for
// connecting as a client, which fails on Windows.
func ConnectableHost() *url.URL {
	u := Host()
	host, port, err := net.SplitHostPort(u.Host)
	if err != nil {
		return u
	}

	if ip := net.ParseIP(host); ip != nil && ip.IsUnspecified() {
		if ip.To4() != nil {
			host = "127.0.0.1"
		} else {
			host = "::1"
		}
		u.Host = net.JoinHostPort(host, port)
	}

	return u
}

// AllowedOrigins returns a list of allowed origins. AllowedOrigins can be configured via the OLLAMA_ORIGINS environment variable.
func AllowedOrigins() (origins []string) {
	if s := Var("OLLAMA_ORIGINS"); s != "" {
		origins = strings.Split(s, ",")
	}

	for _, origin := range []string{"localhost", "127.0.0.1", "0.0.0.0"} {
		origins = append(origins,
			fmt.Sprintf("http://%s", origin),
			fmt.Sprintf("https://%s", origin),
			fmt.Sprintf("http://%s", net.JoinHostPort(origin, "*")),
			fmt.Sprintf("https://%s", net.JoinHostPort(origin, "*")),
		)
	}

	origins = append(origins,
		"app://*",
		"file://*",
		"tauri://*",
		"vscode-webview://*",
		"vscode-file://*",
	)

	return origins
}

// Models returns the path to the models directory. Models directory can be configured via the OLLAMA_MODELS environment variable.
// Default is $HOME/.ollama/models
func Models() string {
	if s := Var("OLLAMA_MODELS"); s != "" {
		return s
	}

	home, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}

	return filepath.Join(home, ".ollama", "models")
}

// KeepAlive returns the duration that models stay loaded in memory. KeepAlive can be configured via the OLLAMA_KEEP_ALIVE environment variable.
// Negative values are treated as infinite. Zero is treated as no keep alive.
// Default is 5 minutes.
func KeepAlive() (keepAlive time.Duration) {
	keepAlive = 5 * time.Minute
	if s := Var("OLLAMA_KEEP_ALIVE"); s != "" {
		if d, err := time.ParseDuration(s); err == nil {
			keepAlive = d
		} else if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			keepAlive = time.Duration(n) * time.Second
		}
	}

	if keepAlive < 0 {
		return time.Duration(math.MaxInt64)
	}

	return keepAlive
}

// LoadTimeout returns the duration for stall detection during model loads. LoadTimeout can be configured via the OLLAMA_LOAD_TIMEOUT environment variable.
// Zero or Negative values are treated as infinite.
// Default is 5 minutes.
func LoadTimeout() (loadTimeout time.Duration) {
	loadTimeout = 5 * time.Minute
	if s := Var("OLLAMA_LOAD_TIMEOUT"); s != "" {
		if d, err := time.ParseDuration(s); err == nil {
			loadTimeout = d
		} else if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			loadTimeout = time.Duration(n) * time.Second
		}
	}

	if loadTimeout <= 0 {
		return time.Duration(math.MaxInt64)
	}

	return loadTimeout
}

func Remotes() []string {
	var r []string
	raw := strings.TrimSpace(Var("OLLAMA_REMOTES"))
	if raw == "" {
		r = []string{"ollama.com"}
	} else {
		r = strings.Split(raw, ",")
	}
	return r
}

func BoolWithDefault(k string) func(defaultValue bool) bool {
	return func(defaultValue bool) bool {
		if s := Var(k); s != "" {
			b, err := strconv.ParseBool(s)
			if err != nil {
				return true
			}

			return b
		}

		return defaultValue
	}
}

func Bool(k string) func() bool {
	withDefault := BoolWithDefault(k)
	return func() bool {
		return withDefault(false)
	}
}

func OptionalBool(key string) (bool, bool) {
	s := Var(key)
	if s == "" {
		return false, false
	}

	b, err := strconv.ParseBool(s)
	if err != nil {
		slog.Warn("invalid environment variable, using default", "key", key, "value", s, "default", false)
		return false, true
	}

	return b, true
}

// LogLevel returns the log level for the application.
// Values are 0 or false INFO (Default), 1 or true DEBUG, 2 TRACE
func LogLevel() slog.Level {
	level := slog.LevelInfo
	if s := Var("OLLAMA_DEBUG"); s != "" {
		if b, _ := strconv.ParseBool(s); b {
			level = slog.LevelDebug
		} else if i, _ := strconv.ParseInt(s, 10, 64); i != 0 {
			level = slog.Level(i * -4)
		}
	}

	return level
}

var (
	// FlashAttention enables the experimental flash attention feature.
	FlashAttention = BoolWithDefault("OLLAMA_FLASH_ATTENTION")
	// DebugLogRequests logs inference requests to disk for replay/debugging.
	DebugLogRequests = Bool("OLLAMA_DEBUG_LOG_REQUESTS")
	// KvCacheType is the quantization type for the K/V cache.
	KvCacheType = String("OLLAMA_KV_CACHE_TYPE")
	// NoHistory disables readline history.
	NoHistory = Bool("OLLAMA_NOHISTORY")
	// NoPrune disables pruning of model blobs on startup.
	NoPrune = Bool("OLLAMA_NOPRUNE")
	// SchedSpread allows scheduling models across all GPUs.
	SchedSpread = Bool("OLLAMA_SCHED_SPREAD")
	// MultiUserCache optimizes prompt caching for multi-user scenarios
	MultiUserCache = Bool("OLLAMA_MULTIUSER_CACHE")
	// Enable the new Ollama engine
	NewEngine = Bool("OLLAMA_NEW_ENGINE")
	// Force the classic bundled llama runner when possible for debugging.
	ForceClassicLlamaRunner = Bool("OLLAMA_FORCE_CLASSIC_LLAMA_RUNNER")
	// ContextLength sets the default context length
	ContextLength = Uint(ContextLengthEnvVar, 0)
	// Auth enables authentication between the Ollama client and server
	UseAuth = Bool("OLLAMA_AUTH")
	// Enable Vulkan backend
	EnableVulkan = Bool("OLLAMA_VULKAN")
	// NoCloudEnv checks the OLLAMA_NO_CLOUD environment variable.
	NoCloudEnv = Bool("OLLAMA_NO_CLOUD")
	// LowVRAMOptimize enables experimental low-VRAM optimization behavior.
	LowVRAMOptimize = Bool("OLLAMA_LOW_VRAM_OPTIMIZE")
	// LowVRAMVerbose enables detailed low-VRAM decision logging.
	LowVRAMVerbose = Bool("OLLAMA_LOW_VRAM_VERBOSE")
	// MoECPUOffload requests experimental MoE CPU offload for supported llama.cpp runners.
	MoECPUOffload = Bool("OLLAMA_MOE_CPU_OFFLOAD")
	// MoETensorOverride contains an advanced llama.cpp tensor override expression.
	MoETensorOverride = String("OLLAMA_MOE_TENSOR_OVERRIDE")
	// LlamaArgPassthrough contains advanced raw llama.cpp runner arguments.
	LlamaArgPassthrough = String("OLLAMA_LLAMA_ARG_PASSTHROUGH")
)

const (
	ContextLengthEnvVar              = "OLLAMA_CONTEXT_LENGTH"
	ContextLengthSourceEnvVar        = "OLLAMA_CONTEXT_LENGTH_SOURCE"
	ContextLengthSourceEnvironment   = "environment"
	ContextLengthSourceGlobalSetting = "global_setting"
	LowVRAMDefaultNumCtx             = 4096

	MoECPUOffloadPolicyFirst       = "first"
	MoECPUOffloadPolicyLast        = "last"
	MoECPUOffloadPolicyAll         = "all"
	MoECPUOffloadPolicyGPUResident = "gpu_resident"
)

var (
	lowVRAMDefaultRetryCtx = []int{4096, 2048, 1024}
	lowVRAMRunnerEnvVars   = []string{
		"OLLAMA_LOW_VRAM_FLASH_ATTENTION",
		"OLLAMA_LOW_VRAM_KV_CACHE_TYPE",
		"OLLAMA_LOW_VRAM_MAX_LOADED_MODELS",
		"OLLAMA_LOW_VRAM_NUM_CTX",
		"OLLAMA_LOW_VRAM_NUM_PARALLEL",
		"OLLAMA_LOW_VRAM_RETRY_CTX",
		"OLLAMA_LOW_VRAM_VERBOSE",
		"OLLAMA_MOE_CPU_OFFLOAD",
		"OLLAMA_MOE_CPU_OFFLOAD_LAYERS",
		"OLLAMA_MOE_CPU_OFFLOAD_POLICY",
		"OLLAMA_MOE_TENSOR_OVERRIDE",
		"OLLAMA_LLAMA_ARG_PASSTHROUGH",
	}
)

// IsSet returns true when an environment variable has a non-empty value after
// applying Ollama's usual environment value trimming.
func IsSet(key string) bool {
	return Var(key) != ""
}

func LowVRAMEnabled() bool {
	return LowVRAMOptimize()
}

func ContextLengthSource() string {
	if !IsSet(ContextLengthEnvVar) {
		return ""
	}

	switch Var(ContextLengthSourceEnvVar) {
	case ContextLengthSourceGlobalSetting:
		return ContextLengthSourceGlobalSetting
	default:
		return ContextLengthSourceEnvironment
	}
}

func isLowVRAMRunnerEnv(key string) bool {
	for _, lowVRAMKey := range lowVRAMRunnerEnvVars {
		if strings.EqualFold(key, lowVRAMKey) {
			return true
		}
	}

	return false
}

func FilteredRunnerEnv(env []string) []string {
	if LowVRAMEnabled() {
		return append([]string(nil), env...)
	}

	filtered := make([]string, 0, len(env))
	for _, entry := range env {
		key, _, ok := strings.Cut(entry, "=")
		if ok && isLowVRAMRunnerEnv(key) {
			continue
		}

		filtered = append(filtered, entry)
	}

	return filtered
}

func RunnerEnv() []string {
	return FilteredRunnerEnv(os.Environ())
}

func parsePositiveUint(key string) (uint, bool) {
	s := Var(key)
	if s == "" {
		return 0, false
	}

	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil || n == 0 {
		slog.Warn("invalid environment variable, ignoring", "key", key, "value", s)
		return 0, false
	}

	return uint(n), true
}

// LowVRAMNumCtx returns the configured low-VRAM default context length, or
// the safe default used by low-VRAM mode.
func LowVRAMNumCtx() uint {
	if n, ok := parsePositiveUint("OLLAMA_LOW_VRAM_NUM_CTX"); ok {
		return n
	}

	return LowVRAMDefaultNumCtx
}

// LowVRAMRetryContexts returns the finite retry context list for low-VRAM
// load fallback. Invalid entries are skipped with a warning.
func LowVRAMRetryContexts() []int {
	s := Var("OLLAMA_LOW_VRAM_RETRY_CTX")
	if s == "" {
		return append([]int(nil), lowVRAMDefaultRetryCtx...)
	}

	var out []int
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		n, err := strconv.ParseInt(part, 10, 64)
		if err != nil || n <= 0 {
			slog.Warn("invalid low VRAM retry context, ignoring", "value", part)
			continue
		}

		out = append(out, int(n))
	}

	if len(out) == 0 {
		slog.Warn("invalid low VRAM retry context list, using default", "value", s)
		return append([]int(nil), lowVRAMDefaultRetryCtx...)
	}

	return out
}

func normalizeKVCacheType(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// ValidKVCacheType reports whether a low-VRAM KV cache type is supported by
// the low-VRAM policy layer. Model-specific support is checked later.
func ValidKVCacheType(cacheType string) bool {
	switch normalizeKVCacheType(cacheType) {
	case "", "f16", "q8_0", "q4_0":
		return true
	default:
		return false
	}
}

// LowVRAMKVCacheType returns a validated low-VRAM KV cache type override.
func LowVRAMKVCacheType() string {
	s := normalizeKVCacheType(Var("OLLAMA_LOW_VRAM_KV_CACHE_TYPE"))
	if s == "" {
		return ""
	}

	if !ValidKVCacheType(s) {
		slog.Warn("invalid OLLAMA_LOW_VRAM_KV_CACHE_TYPE, ignoring", "type", s)
		return ""
	}

	return s
}

// EffectiveKVCacheType returns the KV cache type preference after applying
// low-VRAM defaults. Runner/model support is still validated by the loader.
func EffectiveKVCacheType() string {
	if !LowVRAMEnabled() {
		return normalizeKVCacheType(KvCacheType())
	}

	if low := LowVRAMKVCacheType(); low != "" {
		return low
	}

	if kv := normalizeKVCacheType(KvCacheType()); kv != "" {
		return kv
	}

	return "q8_0"
}

// LowVRAMFlashAttention returns true only when low-VRAM flash attention was
// explicitly requested.
func LowVRAMFlashAttention() bool {
	b, _ := OptionalBool("OLLAMA_LOW_VRAM_FLASH_ATTENTION")
	return b
}

// MoECPUOffloadLayers returns the requested MoE CPU-offload layer count.
// Invalid values are ignored so unsupported or experimental settings never
// prevent normal model loading.
func MoECPUOffloadLayers() (int, bool) {
	s := Var("OLLAMA_MOE_CPU_OFFLOAD_LAYERS")
	if s == "" {
		return 0, false
	}

	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n <= 0 {
		slog.Warn("invalid OLLAMA_MOE_CPU_OFFLOAD_LAYERS, ignoring", "value", s)
		return 0, false
	}

	return int(n), true
}

func MoECPUOffloadPolicy() string {
	s := strings.ToLower(strings.TrimSpace(Var("OLLAMA_MOE_CPU_OFFLOAD_POLICY")))
	switch s {
	case "", MoECPUOffloadPolicyFirst:
		return MoECPUOffloadPolicyFirst
	case MoECPUOffloadPolicyLast, MoECPUOffloadPolicyAll, MoECPUOffloadPolicyGPUResident:
		return s
	default:
		slog.Warn("invalid OLLAMA_MOE_CPU_OFFLOAD_POLICY, using default", "value", s, "default", MoECPUOffloadPolicyFirst)
		return MoECPUOffloadPolicyFirst
	}
}

// EffectiveNumParallel returns the scheduler parallelism after applying the
// low-VRAM default. Existing explicit OLLAMA_NUM_PARALLEL wins unless the
// low-VRAM-specific override is set.
func EffectiveNumParallel() uint {
	if !LowVRAMEnabled() {
		return NumParallel()
	}

	if n, ok := parsePositiveUint("OLLAMA_LOW_VRAM_NUM_PARALLEL"); ok {
		return n
	}

	if IsSet("OLLAMA_NUM_PARALLEL") {
		return NumParallel()
	}

	return 1
}

// EffectiveMaxRunners returns the maximum number of concurrently loaded
// models after applying the low-VRAM default. Existing explicit
// OLLAMA_MAX_LOADED_MODELS wins unless the low-VRAM-specific override is set.
func EffectiveMaxRunners() uint {
	if !LowVRAMEnabled() {
		return MaxRunners()
	}

	if n, ok := parsePositiveUint("OLLAMA_LOW_VRAM_MAX_LOADED_MODELS"); ok {
		return n
	}

	if IsSet("OLLAMA_MAX_LOADED_MODELS") {
		return MaxRunners()
	}

	return 1
}

func String(s string) func() string {
	return func() string {
		return Var(s)
	}
}

var (
	LLMLibrary = String("OLLAMA_LLM_LIBRARY")
	Editor     = String("OLLAMA_EDITOR")

	CudaVisibleDevices    = String("CUDA_VISIBLE_DEVICES")
	HipVisibleDevices     = String("HIP_VISIBLE_DEVICES")
	RocrVisibleDevices    = String("ROCR_VISIBLE_DEVICES")
	VkVisibleDevices      = String("GGML_VK_VISIBLE_DEVICES")
	GpuDeviceOrdinal      = String("GPU_DEVICE_ORDINAL")
	HsaOverrideGfxVersion = String("HSA_OVERRIDE_GFX_VERSION")
)

func Uint(key string, defaultValue uint) func() uint {
	return func() uint {
		if s := Var(key); s != "" {
			if n, err := strconv.ParseUint(s, 10, 64); err != nil {
				slog.Warn("invalid environment variable, using default", "key", key, "value", s, "default", defaultValue)
			} else {
				return uint(n)
			}
		}

		return defaultValue
	}
}

var (
	// NumParallel sets the number of parallel model requests. NumParallel can be configured via the OLLAMA_NUM_PARALLEL environment variable.
	NumParallel = Uint("OLLAMA_NUM_PARALLEL", 1)
	// MaxRunners sets the maximum number of loaded models. MaxRunners can be configured via the OLLAMA_MAX_LOADED_MODELS environment variable.
	MaxRunners = Uint("OLLAMA_MAX_LOADED_MODELS", 0)
	// MaxQueue sets the maximum number of queued requests. MaxQueue can be configured via the OLLAMA_MAX_QUEUE environment variable.
	MaxQueue = Uint("OLLAMA_MAX_QUEUE", 512)
)

func Uint64(key string, defaultValue uint64) func() uint64 {
	return func() uint64 {
		if s := Var(key); s != "" {
			if n, err := strconv.ParseUint(s, 10, 64); err != nil {
				slog.Warn("invalid environment variable, using default", "key", key, "value", s, "default", defaultValue)
			} else {
				return n
			}
		}

		return defaultValue
	}
}

// Set aside VRAM per GPU
var GpuOverhead = Uint64("OLLAMA_GPU_OVERHEAD", 0)

type EnvVar struct {
	Name        string
	Value       any
	Description string
}

func AsMap() map[string]EnvVar {
	ret := map[string]EnvVar{
		"OLLAMA_DEBUG":                      {"OLLAMA_DEBUG", LogLevel(), "Show additional debug information (e.g. OLLAMA_DEBUG=1)"},
		"OLLAMA_DEBUG_LOG_REQUESTS":         {"OLLAMA_DEBUG_LOG_REQUESTS", DebugLogRequests(), "Log inference request bodies and replay curl commands to a temp directory"},
		"OLLAMA_FLASH_ATTENTION":            {"OLLAMA_FLASH_ATTENTION", FlashAttention(false), "Enabled flash attention"},
		"OLLAMA_KV_CACHE_TYPE":              {"OLLAMA_KV_CACHE_TYPE", KvCacheType(), "Quantization type for the K/V cache (default: f16)"},
		"OLLAMA_GPU_OVERHEAD":               {"OLLAMA_GPU_OVERHEAD", GpuOverhead(), "Reserve a portion of VRAM per GPU (bytes)"},
		"OLLAMA_HOST":                       {"OLLAMA_HOST", Host(), "IP Address for the ollama server (default 127.0.0.1:11434)"},
		"OLLAMA_KEEP_ALIVE":                 {"OLLAMA_KEEP_ALIVE", KeepAlive(), "The duration that models stay loaded in memory (default \"5m\")"},
		"OLLAMA_LLM_LIBRARY":                {"OLLAMA_LLM_LIBRARY", LLMLibrary(), "Set LLM library to bypass autodetection"},
		"OLLAMA_LOAD_TIMEOUT":               {"OLLAMA_LOAD_TIMEOUT", LoadTimeout(), "How long to allow model loads to stall before giving up (default \"5m\")"},
		"OLLAMA_MAX_LOADED_MODELS":          {"OLLAMA_MAX_LOADED_MODELS", MaxRunners(), "Maximum number of loaded models per GPU"},
		"OLLAMA_MAX_QUEUE":                  {"OLLAMA_MAX_QUEUE", MaxQueue(), "Maximum number of queued requests"},
		"OLLAMA_MODELS":                     {"OLLAMA_MODELS", Models(), "The path to the models directory"},
		"OLLAMA_NO_CLOUD":                   {"OLLAMA_NO_CLOUD", NoCloud(), "Disable Ollama cloud features (remote inference and web search)"},
		"OLLAMA_NOHISTORY":                  {"OLLAMA_NOHISTORY", NoHistory(), "Do not preserve readline history"},
		"OLLAMA_NOPRUNE":                    {"OLLAMA_NOPRUNE", NoPrune(), "Do not prune model blobs on startup"},
		"OLLAMA_NUM_PARALLEL":               {"OLLAMA_NUM_PARALLEL", NumParallel(), "Maximum number of parallel requests"},
		"OLLAMA_ORIGINS":                    {"OLLAMA_ORIGINS", AllowedOrigins(), "A comma separated list of allowed origins"},
		"OLLAMA_SCHED_SPREAD":               {"OLLAMA_SCHED_SPREAD", SchedSpread(), "Always schedule model across all GPUs"},
		"OLLAMA_MULTIUSER_CACHE":            {"OLLAMA_MULTIUSER_CACHE", MultiUserCache(), "Optimize prompt caching for multi-user scenarios"},
		"OLLAMA_CONTEXT_LENGTH":             {"OLLAMA_CONTEXT_LENGTH", ContextLength(), "Context length to use unless otherwise specified (default: 4k/32k/256k based on VRAM)"},
		"OLLAMA_EDITOR":                     {"OLLAMA_EDITOR", Editor(), "Path to editor for interactive prompt editing (Ctrl+G)"},
		"OLLAMA_NEW_ENGINE":                 {"OLLAMA_NEW_ENGINE", NewEngine(), "Enable the new Ollama engine"},
		"OLLAMA_FORCE_CLASSIC_LLAMA_RUNNER": {"OLLAMA_FORCE_CLASSIC_LLAMA_RUNNER", ForceClassicLlamaRunner(), "Force the classic bundled llama runner when possible for debugging"},
		"OLLAMA_REMOTES":                    {"OLLAMA_REMOTES", Remotes(), "Allowed hosts for remote models (default \"ollama.com\")"},

		"OLLAMA_LOW_VRAM_OPTIMIZE":          {"OLLAMA_LOW_VRAM_OPTIMIZE", LowVRAMOptimize(), "Enable experimental low-VRAM optimization mode"},
		"OLLAMA_LOW_VRAM_NUM_CTX":           {"OLLAMA_LOW_VRAM_NUM_CTX", LowVRAMNumCtx(), "Default context length when low-VRAM mode is enabled and no context is explicitly set"},
		"OLLAMA_LOW_VRAM_RETRY_CTX":         {"OLLAMA_LOW_VRAM_RETRY_CTX", LowVRAMRetryContexts(), "Comma-separated context lengths to retry after memory-related load failures in low-VRAM mode"},
		"OLLAMA_LOW_VRAM_KV_CACHE_TYPE":     {"OLLAMA_LOW_VRAM_KV_CACHE_TYPE", LowVRAMKVCacheType(), "KV cache type for low-VRAM mode (f16, q8_0, or q4_0)"},
		"OLLAMA_LOW_VRAM_FLASH_ATTENTION":   {"OLLAMA_LOW_VRAM_FLASH_ATTENTION", LowVRAMFlashAttention(), "Prefer flash attention when low-VRAM mode is enabled"},
		"OLLAMA_LOW_VRAM_NUM_PARALLEL":      {"OLLAMA_LOW_VRAM_NUM_PARALLEL", EffectiveNumParallel(), "Parallel request count to prefer when low-VRAM mode is enabled"},
		"OLLAMA_LOW_VRAM_MAX_LOADED_MODELS": {"OLLAMA_LOW_VRAM_MAX_LOADED_MODELS", EffectiveMaxRunners(), "Maximum loaded models to prefer when low-VRAM mode is enabled"},
		"OLLAMA_LOW_VRAM_VERBOSE":           {"OLLAMA_LOW_VRAM_VERBOSE", LowVRAMVerbose(), "Enable detailed low-VRAM decision logging"},
		"OLLAMA_MOE_CPU_OFFLOAD":            {"OLLAMA_MOE_CPU_OFFLOAD", MoECPUOffload(), "Request experimental MoE CPU offload when low-VRAM mode and runner support are available"},
		"OLLAMA_MOE_CPU_OFFLOAD_LAYERS":     {"OLLAMA_MOE_CPU_OFFLOAD_LAYERS", Var("OLLAMA_MOE_CPU_OFFLOAD_LAYERS"), "Optional MoE CPU-offload layer count for supported llama.cpp runners"},
		"OLLAMA_MOE_CPU_OFFLOAD_POLICY":     {"OLLAMA_MOE_CPU_OFFLOAD_POLICY", MoECPUOffloadPolicy(), "MoE CPU-offload tensor selection policy: first, last, all, or gpu_resident"},
		"OLLAMA_MOE_TENSOR_OVERRIDE":        {"OLLAMA_MOE_TENSOR_OVERRIDE", MoETensorOverride(), "Advanced llama.cpp tensor override expression for low-VRAM MoE experiments"},
		"OLLAMA_LLAMA_ARG_PASSTHROUGH":      {"OLLAMA_LLAMA_ARG_PASSTHROUGH", LlamaArgPassthrough(), "Advanced raw llama.cpp runner arguments for low-VRAM experiments"},

		// Informational
		"HTTP_PROXY":  {"HTTP_PROXY", String("HTTP_PROXY")(), "HTTP proxy"},
		"HTTPS_PROXY": {"HTTPS_PROXY", String("HTTPS_PROXY")(), "HTTPS proxy"},
		"NO_PROXY":    {"NO_PROXY", String("NO_PROXY")(), "No proxy"},
	}

	if runtime.GOOS != "windows" {
		// Windows environment variables are case-insensitive so there's no need to duplicate them
		ret["http_proxy"] = EnvVar{"http_proxy", String("http_proxy")(), "HTTP proxy"}
		ret["https_proxy"] = EnvVar{"https_proxy", String("https_proxy")(), "HTTPS proxy"}
		ret["no_proxy"] = EnvVar{"no_proxy", String("no_proxy")(), "No proxy"}
	}

	if runtime.GOOS != "darwin" {
		ret["CUDA_VISIBLE_DEVICES"] = EnvVar{"CUDA_VISIBLE_DEVICES", CudaVisibleDevices(), "Set which NVIDIA devices are visible"}
		ret["HIP_VISIBLE_DEVICES"] = EnvVar{"HIP_VISIBLE_DEVICES", HipVisibleDevices(), "Set which AMD devices are visible by numeric ID"}
		ret["ROCR_VISIBLE_DEVICES"] = EnvVar{"ROCR_VISIBLE_DEVICES", RocrVisibleDevices(), "Set which AMD devices are visible by UUID or numeric ID"}
		ret["GGML_VK_VISIBLE_DEVICES"] = EnvVar{"GGML_VK_VISIBLE_DEVICES", VkVisibleDevices(), "Set which Vulkan devices are visible by numeric ID"}
		ret["GPU_DEVICE_ORDINAL"] = EnvVar{"GPU_DEVICE_ORDINAL", GpuDeviceOrdinal(), "Set which AMD devices are visible by numeric ID"}
		ret["HSA_OVERRIDE_GFX_VERSION"] = EnvVar{"HSA_OVERRIDE_GFX_VERSION", HsaOverrideGfxVersion(), "Override the gfx used for all detected AMD GPUs"}
		ret["OLLAMA_VULKAN"] = EnvVar{"OLLAMA_VULKAN", EnableVulkan(), "Enable experimental Vulkan support"}
	}

	return ret
}

func Values() map[string]string {
	vals := make(map[string]string)
	for k, v := range AsMap() {
		vals[k] = fmt.Sprintf("%v", v.Value)
	}
	return vals
}

// Var returns an environment variable stripped of leading and trailing quotes or spaces
func Var(key string) string {
	return strings.Trim(strings.TrimSpace(os.Getenv(key)), "\"'")
}

// serverConfigData holds the parsed fields from ~/.ollama/server.json.
type serverConfigData struct {
	DisableOllamaCloud bool `json:"disable_ollama_cloud,omitempty"`
}

var (
	serverCfgMu     sync.RWMutex
	serverCfgLoaded bool
	serverCfg       serverConfigData
)

func loadServerConfig() {
	serverCfgMu.RLock()
	if serverCfgLoaded {
		serverCfgMu.RUnlock()
		return
	}
	serverCfgMu.RUnlock()

	cfg := serverConfigData{}
	home, err := os.UserHomeDir()
	if err == nil {
		path := filepath.Join(home, ".ollama", "server.json")
		data, err := os.ReadFile(path)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				slog.Debug("envconfig: could not read server config", "error", err)
			}
		} else if err := json.Unmarshal(data, &cfg); err != nil {
			slog.Debug("envconfig: could not parse server config", "error", err)
		}
	}

	serverCfgMu.Lock()
	defer serverCfgMu.Unlock()
	if serverCfgLoaded {
		return
	}
	serverCfg = cfg
	serverCfgLoaded = true
}

func cachedServerConfig() serverConfigData {
	serverCfgMu.RLock()
	defer serverCfgMu.RUnlock()
	return serverCfg
}

// ReloadServerConfig refreshes the cached ~/.ollama/server.json settings.
func ReloadServerConfig() {
	serverCfgMu.Lock()
	serverCfgLoaded = false
	serverCfg = serverConfigData{}
	serverCfgMu.Unlock()

	loadServerConfig()
}

// NoCloud returns true if Ollama cloud features are disabled,
// checking both the OLLAMA_NO_CLOUD environment variable and
// the disable_ollama_cloud field in ~/.ollama/server.json.
func NoCloud() bool {
	if NoCloudEnv() {
		return true
	}
	loadServerConfig()
	return cachedServerConfig().DisableOllamaCloud
}

// NoCloudSource returns the source of the cloud-disabled decision.
// Returns "none", "env", "config", or "both".
func NoCloudSource() string {
	envDisabled := NoCloudEnv()
	loadServerConfig()
	configDisabled := cachedServerConfig().DisableOllamaCloud

	switch {
	case envDisabled && configDisabled:
		return "both"
	case envDisabled:
		return "env"
	case configDisabled:
		return "config"
	default:
		return "none"
	}
}
