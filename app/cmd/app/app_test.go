//go:build windows || darwin

package main

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
)

func TestCheckUserLoggedInUsesDesktopTokenCookie(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/user" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}

		cookie, err := r.Cookie("token")
		if err != nil || cookie.Value != "secret-token" {
			t.Fatalf("missing desktop token cookie: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"user": map[string]string{
				"id":    "user-1",
				"email": "user@example.com",
				"name":  "Test User",
			},
		})
	}))
	defer server.Close()

	if !checkUserLoggedIn(testServerPort(t, server.URL), "secret-token") {
		t.Fatal("expected user to be logged in")
	}
}

func TestCheckUserLoggedInReturnsFalseForAnonymousUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"user": nil})
	}))
	defer server.Close()

	if checkUserLoggedIn(testServerPort(t, server.URL), "secret-token") {
		t.Fatal("expected anonymous user to be treated as logged out")
	}
}

func TestCheckUserLoggedInSkipsWhenTokenMissing(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	defer server.Close()

	if checkUserLoggedIn(testServerPort(t, server.URL), "") {
		t.Fatal("expected missing token to be treated as logged out")
	}
	if called {
		t.Fatal("expected auth endpoint not to be called without a desktop token")
	}
}

func TestPathWithToken(t *testing.T) {
	tests := []struct {
		name  string
		path  string
		token string
		want  string
	}{
		{
			name:  "defaults empty path to root",
			path:  "",
			token: "secret-token",
			want:  "/?ollama_token=secret-token",
		},
		{
			name:  "preserves existing query and fragment",
			path:  "/settings/?view=local#models",
			token: "secret token",
			want:  "/settings/?ollama_token=secret+token&view=local#models",
		},
		{
			name:  "replaces existing desktop token",
			path:  "/?ollama_token=old&x=1",
			token: "new-token",
			want:  "/?ollama_token=new-token&x=1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := pathWithToken(tt.path, tt.token); got != tt.want {
				t.Fatalf("pathWithToken(%q, %q) = %q, want %q", tt.path, tt.token, got, tt.want)
			}
		})
	}
}

func TestParseURLScheme(t *testing.T) {
	tests := []struct {
		name        string
		rawURL      string
		wantConnect bool
		wantErr     bool
	}{
		{
			name:   "bare hostless URL opens app",
			rawURL: "ollama://",
		},
		{
			name:   "bare slash URL opens app",
			rawURL: "ollama:///",
		},
		{
			name:        "connect host starts OAuth flow",
			rawURL:      "ollama://connect",
			wantConnect: true,
		},
		{
			name:        "connect path starts OAuth flow",
			rawURL:      "ollama:///connect",
			wantConnect: true,
		},
		{
			name:    "unsupported app path is rejected",
			rawURL:  "ollama://settings",
			wantErr: true,
		},
		{
			name:    "malformed URL is rejected",
			rawURL:  "ollama://[::1",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotConnect, err := parseURLScheme(tt.rawURL)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected parse error")
				}
				return
			}
			if err != nil {
				t.Fatalf("parseURLScheme(%q) error = %v", tt.rawURL, err)
			}
			if gotConnect != tt.wantConnect {
				t.Fatalf("parseURLScheme(%q) connect = %t, want %t", tt.rawURL, gotConnect, tt.wantConnect)
			}
		})
	}
}

func testServerPort(t *testing.T, rawURL string) int {
	t.Helper()

	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse server URL: %v", err)
	}
	_, port, err := net.SplitHostPort(parsed.Host)
	if err != nil {
		t.Fatalf("split server host: %v", err)
	}
	parsedPort, err := strconv.Atoi(port)
	if err != nil {
		t.Fatalf("parse server port: %v", err)
	}
	return parsedPort
}
