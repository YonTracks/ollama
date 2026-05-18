//go:build windows || darwin

package ui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ollama/ollama/app/ui/responses"
)

func TestSearchMissingQuery(t *testing.T) {
	t.Setenv("SEARCH_PROVIDER", "brave")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/search", nil)
	(&Server{Dev: true}).Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, rr.Code)
	}

	var got responses.SearchResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Error != "Missing search query." {
		t.Fatalf("expected missing query error, got %#v", got)
	}
}

func TestSearchDisabledProvider(t *testing.T) {
	t.Setenv("SEARCH_PROVIDER", "off")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/search?q=ollama", nil)
	(&Server{Dev: true}).Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rr.Code)
	}

	var got responses.SearchResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.Disabled || got.Provider != "off" || got.Query != "ollama" || len(got.Results) != 0 {
		t.Fatalf("expected disabled off response, got %#v", got)
	}
}

func TestSearchRejectsLongQuery(t *testing.T) {
	query := strings.Repeat("x", maxSearchQueryChars+1)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/search?q="+query, nil)
	(&Server{Dev: true}).Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, rr.Code)
	}

	var got responses.SearchResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Error != "Search query is too long." {
		t.Fatalf("unexpected long query error: %#v", got)
	}
}

func TestSearchBraveProxy(t *testing.T) {
	brave := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/res/v1/web/search" {
			t.Fatalf("expected Brave search path, got %q", r.URL.Path)
		}
		if r.URL.Query().Get("q") != "ollama" {
			t.Fatalf("expected query to be forwarded, got %q", r.URL.RawQuery)
		}
		if r.URL.Query().Get("safesearch") != "off" {
			t.Fatalf("expected safe override, got %q", r.URL.RawQuery)
		}
		if r.Header.Get("X-Subscription-Token") != "secret-brave-key" {
			t.Fatalf("expected API key header")
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"web": map[string]any{
				"results": []map[string]any{
					{
						"title":       "Ollama",
						"url":         "https://ollama.com/",
						"description": "Run local models.",
						"profile":     map[string]any{"name": "Ollama"},
					},
					{
						"title":       "Bad",
						"url":         "javascript:alert(1)",
						"description": "Bad URL.",
					},
				},
			},
		})
	}))
	defer brave.Close()

	t.Setenv("BRAVE_SEARCH_API_KEY", "secret-brave-key")
	oldEndpoint := braveSearchEndpoint
	braveSearchEndpoint = brave.URL + "/res/v1/web/search"
	defer func() { braveSearchEndpoint = oldEndpoint }()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/search?q=ollama&provider=brave&safe=false", nil)
	(&Server{Dev: true}).Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, rr.Code, rr.Body.String())
	}

	var got responses.SearchResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Provider != "brave" || got.Disabled || len(got.Results) != 1 {
		t.Fatalf("expected one Brave result, got %#v", got)
	}
	if got.Results[0].URL != "https://ollama.com/" || got.Results[0].Engine != "brave" {
		t.Fatalf("unexpected result: %#v", got.Results[0])
	}
	if strings.Contains(rr.Body.String(), "secret-brave-key") {
		t.Fatalf("response exposed API key")
	}
}

func TestSearchMissingAPIKey(t *testing.T) {
	t.Setenv("BRAVE_SEARCH_API_KEY", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/search?q=ollama&provider=brave", nil)
	(&Server{Dev: true}).Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, rr.Code)
	}

	var got responses.SearchResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Error != "Web search is enabled, but BRAVE_SEARCH_API_KEY is missing." {
		t.Fatalf("unexpected error: %#v", got)
	}
}

func TestSearchHealthOff(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/search/health?provider=off", nil)
	(&Server{Dev: true}).Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rr.Code)
	}

	var got responses.SearchHealthResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Provider != "off" || !got.Configured || !got.Reachable || got.Error != nil {
		t.Fatalf("unexpected health response: %#v", got)
	}
}

func TestSearchHealthMissingBraveKey(t *testing.T) {
	t.Setenv("BRAVE_SEARCH_API_KEY", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/search/health?provider=brave", nil)
	(&Server{Dev: true}).Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rr.Code)
	}

	var got responses.SearchHealthResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Provider != "brave" || got.Configured || got.Reachable || got.Error == nil {
		t.Fatalf("unexpected health response: %#v", got)
	}
	if !strings.Contains(*got.Error, "BRAVE_SEARCH_API_KEY") {
		t.Fatalf("expected missing key in health error, got %#v", got)
	}
}

func TestSearchHealthMissingTavilyKey(t *testing.T) {
	t.Setenv("TAVILY_API_KEY", "")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/search/health?provider=tavily", nil)
	(&Server{Dev: true}).Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rr.Code)
	}

	var got responses.SearchHealthResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Provider != "tavily" || got.Configured || got.Reachable || got.Error == nil {
		t.Fatalf("unexpected health response: %#v", got)
	}
	if !strings.Contains(*got.Error, "TAVILY_API_KEY") {
		t.Fatalf("expected missing key in health error, got %#v", got)
	}
}
