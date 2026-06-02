package imagegen

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ollama/ollama/llm"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func newCompletionTestServer(handler func(*http.Request) string) *Server {
	return &Server{
		port: 11434,
		done: make(chan error, 1),
		client: &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				body := handler(req)
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     make(http.Header),
					Body:       io.NopCloser(strings.NewReader(body)),
					Request:    req,
				}, nil
			}),
		},
	}
}

func TestCompletionReturnsImageData(t *testing.T) {
	s := newCompletionTestServer(func(r *http.Request) string {
		if r.URL.Path != "/completion" {
			t.Fatalf("path = %q, want /completion", r.URL.Path)
		}

		var req Request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req.Prompt != "test prompt" || req.Width != 512 || req.Height != 256 || req.Steps != 7 || req.Seed != 42 {
			t.Fatalf("unexpected request: %+v", req)
		}
		if len(req.Images) != 1 || string(req.Images[0]) != "input-image" {
			t.Fatalf("images = %q, want input-image", req.Images)
		}

		return `{"step":1,"total":2}` + "\n" +
			`{"done":true,"image":"base64png"}` + "\n"
	})

	var responses []llm.CompletionResponse
	err := s.Completion(context.Background(), llm.CompletionRequest{
		Prompt: "test prompt",
		Width:  512,
		Height: 256,
		Steps:  7,
		Seed:   42,
		Media:  []llm.MediaData{llm.NewMediaData(0, []byte("input-image"))},
	}, func(resp llm.CompletionResponse) {
		responses = append(responses, resp)
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(responses) != 2 {
		t.Fatalf("responses = %d, want 2", len(responses))
	}
	if responses[0].Step != 1 || responses[0].TotalSteps != 2 || responses[0].Done {
		t.Fatalf("progress response = %+v", responses[0])
	}
	if !responses[1].Done || responses[1].Image != "base64png" {
		t.Fatalf("final response = %+v", responses[1])
	}
}

func TestCompletionEOFBeforeDoneReturnsError(t *testing.T) {
	s := newCompletionTestServer(func(r *http.Request) string {
		return `{"step":1,"total":2}` + "\n"
	})

	var responses []llm.CompletionResponse
	err := s.Completion(context.Background(), llm.CompletionRequest{Prompt: "test prompt"}, func(resp llm.CompletionResponse) {
		responses = append(responses, resp)
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "closed response before completion") {
		t.Fatalf("error = %v", err)
	}
	if len(responses) != 1 || responses[0].Done {
		t.Fatalf("responses = %+v, want one non-done progress response", responses)
	}
}

func TestConfigureMLXSubprocessEnvAddsMLXDirsAndCUDAHeaders(t *testing.T) {
	root := t.TempDir()
	mlxCUDA := filepath.Join(root, "mlx_cuda_v13")
	if err := os.MkdirAll(filepath.Join(mlxCUDA, "include"), 0o755); err != nil {
		t.Fatal(err)
	}
	mlxOther := filepath.Join(root, "mlx_cuda_v12")
	if err := os.MkdirAll(mlxOther, 0o755); err != nil {
		t.Fatal(err)
	}
	backend := filepath.Join(root, "cuda_v13")
	if err := os.MkdirAll(backend, 0o755); err != nil {
		t.Fatal(err)
	}

	existingRuntimePath := filepath.Join(t.TempDir(), "existing-runtime")
	existingOllamaPath := filepath.Join(t.TempDir(), "existing-ollama")
	pathEnv := mlxLibraryPathEnv()
	t.Setenv(pathEnv, existingRuntimePath)
	t.Setenv("OLLAMA_LIBRARY_PATH", existingOllamaPath)

	cmd := exec.Command("ollama-test")
	cmd.Env = os.Environ()
	configureMLXSubprocessEnv(cmd, []string{root, backend})

	env := envMap(cmd.Env)
	gotRuntimePaths := filepath.SplitList(env[pathEnv])
	wantRuntimePaths := []string{root, mlxCUDA, mlxOther, backend, existingRuntimePath}
	if !samePathListPrefix(gotRuntimePaths, wantRuntimePaths) {
		t.Fatalf("%s = %q, want prefix %q", pathEnv, gotRuntimePaths, wantRuntimePaths)
	}

	gotOllamaPaths := filepath.SplitList(env["OLLAMA_LIBRARY_PATH"])
	wantOllamaPaths := []string{root, mlxCUDA, mlxOther, backend, existingOllamaPath}
	if !samePathListPrefix(gotOllamaPaths, wantOllamaPaths) {
		t.Fatalf("OLLAMA_LIBRARY_PATH = %q, want prefix %q", gotOllamaPaths, wantOllamaPaths)
	}

	if got := env["CUDA_PATH"]; got != mlxCUDA {
		t.Fatalf("CUDA_PATH = %q, want %q", got, mlxCUDA)
	}
	if got := env["CUDA_HOME"]; got != mlxCUDA {
		t.Fatalf("CUDA_HOME = %q, want %q", got, mlxCUDA)
	}
}

func envMap(env []string) map[string]string {
	out := map[string]string{}
	for _, entry := range env {
		key, value, ok := strings.Cut(entry, "=")
		if ok {
			out[key] = value
		}
	}
	return out
}

func samePathListPrefix(got, want []string) bool {
	if len(got) < len(want) {
		return false
	}
	for i := range want {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
