package server

import (
	"testing"

	"github.com/ollama/ollama/envconfig"
)

func setTestHome(t *testing.T, home string) {
	t.Helper()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("OLLAMA_MODELS", "")
	t.Setenv("OLLAMA_API_TOKEN", "")
	envconfig.ReloadServerConfig()
}
