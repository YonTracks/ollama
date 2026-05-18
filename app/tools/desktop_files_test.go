//go:build windows || darwin

package tools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegisterDesktopTools(t *testing.T) {
	registry := NewRegistry()
	RegisterDesktopTools(registry)

	for _, name := range []string{"desktop.list_files", "desktop.read_text_file", "desktop.search_files"} {
		if _, ok := registry.Get(name); !ok {
			t.Fatalf("expected registered tool %q", name)
		}
	}
}

func TestDesktopReadTextFileScopedToWorkingDir(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "workspace")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("alpha\nbeta\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "secret.txt"), []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}

	tool := NewReadTextFileTool()
	tool.SetWorkingDir(root)

	result, content, err := tool.Execute(t.Context(), map[string]any{"path": "notes.txt"})
	if err != nil {
		t.Fatalf("read_text_file failed: %v", err)
	}
	readResult := result.(ReadTextFileResult)
	if readResult.Path != "notes.txt" || !strings.Contains(content, "alpha") {
		t.Fatalf("unexpected read result: %#v\n%s", readResult, content)
	}

	_, _, err = tool.Execute(t.Context(), map[string]any{"path": "../secret.txt"})
	if err == nil || !strings.Contains(err.Error(), "outside the configured working directory") {
		t.Fatalf("expected path escape error, got %v", err)
	}
}

func TestListFilesSkipsHiddenByDefault(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "visible.txt"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}

	tool := NewListFilesTool()
	tool.SetWorkingDir(root)

	result, _, err := tool.Execute(t.Context(), map[string]any{})
	if err != nil {
		t.Fatalf("list_files failed: %v", err)
	}
	listResult := result.(ListFilesResult)
	if len(listResult.Entries) != 1 || listResult.Entries[0].Name != "visible.txt" {
		t.Fatalf("expected only visible.txt, got %#v", listResult.Entries)
	}

	_, _, err = tool.Execute(t.Context(), map[string]any{"include_hidden": true})
	if err == nil || !strings.Contains(err.Error(), "OLLAMA_DESKTOP_TOOLS_SENSITIVE") {
		t.Fatalf("expected sensitive hidden access error, got %v", err)
	}

	t.Setenv("OLLAMA_DESKTOP_TOOLS_SENSITIVE", "1")
	result, _, err = tool.Execute(t.Context(), map[string]any{"include_hidden": true})
	if err != nil {
		t.Fatalf("list_files include_hidden failed: %v", err)
	}
	listResult = result.(ListFilesResult)
	if len(listResult.Entries) != 2 {
		t.Fatalf("expected two entries with hidden files included, got %#v", listResult.Entries)
	}
}

func TestSearchFilesSkipsGeneratedByDefault(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "node_modules", "pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "main.go"), []byte("package main\nconst value = \"Needle\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "node_modules", "pkg", "main.go"), []byte("const value = \"Needle\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	tool := NewSearchFilesTool()
	tool.SetWorkingDir(root)

	result, _, err := tool.Execute(t.Context(), map[string]any{"query": "needle", "extensions": []any{".go"}})
	if err != nil {
		t.Fatalf("search_files failed: %v", err)
	}
	searchResult := result.(SearchFilesResult)
	if len(searchResult.Matches) != 1 || searchResult.Matches[0].Path != "src/main.go" {
		t.Fatalf("expected only src/main.go by default, got %#v", searchResult.Matches)
	}

	_, _, err = tool.Execute(t.Context(), map[string]any{
		"query":             "needle",
		"extensions":        []any{".go"},
		"include_generated": true,
	})
	if err == nil || !strings.Contains(err.Error(), "OLLAMA_DESKTOP_TOOLS_SENSITIVE") {
		t.Fatalf("expected sensitive generated access error, got %v", err)
	}

	t.Setenv("OLLAMA_DESKTOP_TOOLS_SENSITIVE", "1")
	result, _, err = tool.Execute(t.Context(), map[string]any{
		"query":             "needle",
		"extensions":        []any{".go"},
		"include_generated": true,
	})
	if err != nil {
		t.Fatalf("search_files include_generated failed: %v", err)
	}
	searchResult = result.(SearchFilesResult)
	if len(searchResult.Matches) != 2 {
		t.Fatalf("expected generated directory match when enabled, got %#v", searchResult.Matches)
	}
}

func TestRegistryPropagatesWorkingDir(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	registry := NewRegistry()
	registry.SetWorkingDir(root)
	registry.Register(NewReadTextFileTool())

	result, _, err := registry.Execute(t.Context(), "desktop.read_text_file", map[string]any{"path": "file.txt"})
	if err != nil {
		t.Fatalf("registry execute failed: %v", err)
	}
	if got := result.(ReadTextFileResult).Content; got != "hello" {
		t.Fatalf("content = %q, want hello", got)
	}
}
