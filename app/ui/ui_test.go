//go:build windows || darwin

package ui

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ollama/ollama/api"
	"github.com/ollama/ollama/app/store"
	apptools "github.com/ollama/ollama/app/tools"
	"github.com/ollama/ollama/app/ui/responses"
	"github.com/ollama/ollama/app/updater"
)

func markDesktopRequest(req *http.Request) {
	req.Header.Set(desktopRequestHeader, desktopRequestHeaderSet)
}

func TestHandlePostApiSettings(t *testing.T) {
	tests := []struct {
		name      string
		requested store.Settings
		wantErr   bool
	}{
		{
			name: "valid settings update - all fields",
			requested: store.Settings{
				Expose:     true,
				Browser:    true,
				Models:     "/custom/models",
				Agent:      true,
				Tools:      true,
				WorkingDir: "/workspace",
			},
			wantErr: false,
		},
		{
			name: "partial settings update",
			requested: store.Settings{
				Agent:      true,
				Tools:      false,
				WorkingDir: "/new/path",
			},
			wantErr: false,
		},
		{
			name: "settings with special characters in paths",
			requested: store.Settings{
				Models:     "/path with spaces/models",
				WorkingDir: "/tmp/work-dir_123",
				Agent:      true,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testStore := &store.Store{
				DBPath: filepath.Join(t.TempDir(), "db.sqlite"),
			}
			defer testStore.Close() // Ensure database is closed before cleanup

			body, err := json.Marshal(tt.requested)
			if err != nil {
				t.Fatalf("failed to marshal test body: %v", err)
			}

			req := httptest.NewRequest("POST", "/api/v1/settings", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()

			// Set up server with test store
			server := &Server{
				Store:   testStore,
				Restart: func() {}, // Mock restart function for tests
			}

			if err := server.settings(rr, req); (err != nil) != tt.wantErr {
				t.Errorf("handlePostApiSettings() error = %v, wantErr %v", err, tt.wantErr)
			}
			if rr.Code != http.StatusOK {
				t.Errorf("handlePostApiSettings() status = %v, want %v", rr.Code, http.StatusOK)
			}

			// Check settings were saved correctly (if no error expected)
			if !tt.wantErr {
				savedSettings, err := testStore.Settings()
				if err != nil {
					t.Errorf("failed to retrieve saved settings: %v", err)
				} else {
					// Compare field by field, accounting for defaults that may be set by the store
					if savedSettings.Expose != tt.requested.Expose {
						t.Errorf("Expose: got %v, want %v", savedSettings.Expose, tt.requested.Expose)
					}
					if savedSettings.Browser != tt.requested.Browser {
						t.Errorf("Browser: got %v, want %v", savedSettings.Browser, tt.requested.Browser)
					}
					wantAgent := tt.requested.Agent
					wantTools := tt.requested.Tools
					if wantAgent && wantTools {
						wantTools = false
					}
					if savedSettings.Agent != wantAgent {
						t.Errorf("Agent: got %v, want %v", savedSettings.Agent, wantAgent)
					}
					if savedSettings.Tools != wantTools {
						t.Errorf("Tools: got %v, want %v", savedSettings.Tools, wantTools)
					}
					if savedSettings.WorkingDir != tt.requested.WorkingDir {
						t.Errorf("WorkingDir: got %q, want %q", savedSettings.WorkingDir, tt.requested.WorkingDir)
					}
					// Only check Models if explicitly set in the test case
					if tt.requested.Models != "" && savedSettings.Models != tt.requested.Models {
						t.Errorf("Models: got %q, want %q", savedSettings.Models, tt.requested.Models)
					}
					if server.Agent != wantAgent {
						t.Errorf("runtime Agent: got %v, want %v", server.Agent, wantAgent)
					}
					if server.Tools != wantTools {
						t.Errorf("runtime Tools: got %v, want %v", server.Tools, wantTools)
					}
					if server.WorkingDir != tt.requested.WorkingDir {
						t.Errorf("runtime WorkingDir: got %q, want %q", server.WorkingDir, tt.requested.WorkingDir)
					}
				}
			}
		})
	}
}

func TestDesktopToolsAvailabilityRequiresEnvAndRegistry(t *testing.T) {
	server := &Server{ToolRegistry: apptools.NewRegistry()}
	server.ToolRegistry.Register(testAppTool{})

	t.Setenv("OLLAMA_DESKTOP_TOOLS", "")
	if server.ToolsAvailable() {
		t.Fatal("tools should be unavailable without OLLAMA_DESKTOP_TOOLS")
	}

	t.Setenv("OLLAMA_DESKTOP_TOOLS", "1")
	if !server.ToolsAvailable() {
		t.Fatal("tools should be available with env gate and registered tools")
	}

	server.Agent = true
	if !server.desktopToolsRequested(responses.ChatRequest{}) {
		t.Fatal("agent mode should request desktop tools when available")
	}
}

func TestHandlerExchangesTokenQueryForHttpOnlyCookie(t *testing.T) {
	server := &Server{Token: "secret-token"}
	req := httptest.NewRequest(http.MethodGet, "/?ollama_token=secret-token", nil)
	rr := httptest.NewRecorder()

	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusFound)
	}
	if got := rr.Header().Get("Location"); got != "/" {
		t.Fatalf("Location = %q, want /", got)
	}
	cookies := rr.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies = %d, want 1", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != "token" || cookie.Value != "secret-token" || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie = %+v, want HttpOnly SameSite=Strict token cookie", cookie)
	}
	if rr.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("Content-Security-Policy header is empty")
	}
}

func TestHandlerDoesNotExchangeTokenOnAPIRoutes(t *testing.T) {
	server := &Server{Token: "secret-token"}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings?ollama_token=secret-token", nil)
	rr := httptest.NewRecorder()

	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusForbidden)
	}
	if got := rr.Header().Values("Set-Cookie"); len(got) != 0 {
		t.Fatalf("Set-Cookie = %v, want none", got)
	}
}

func TestValidateCustomSearchEndpointBlocksLocalhost(t *testing.T) {
	t.Setenv("CUSTOM_SEARCH_ALLOW_LOCAL", "")
	endpoint, err := url.Parse("http://127.0.0.1:8080/search")
	if err != nil {
		t.Fatal(err)
	}
	if err := validateCustomSearchEndpoint(context.Background(), endpoint); err == nil {
		t.Fatal("expected localhost custom search endpoint to be blocked")
	}
}

func TestValidateCustomSearchEndpointAllowsLocalOverride(t *testing.T) {
	t.Setenv("CUSTOM_SEARCH_ALLOW_LOCAL", "true")
	endpoint, err := url.Parse("http://127.0.0.1:8080/search")
	if err != nil {
		t.Fatal(err)
	}
	if err := validateCustomSearchEndpoint(context.Background(), endpoint); err != nil {
		t.Fatalf("validateCustomSearchEndpoint() error = %v", err)
	}
}

func TestCustomSearchRedirectAndDialGuardsBlockLocalTargets(t *testing.T) {
	t.Setenv("CUSTOM_SEARCH_ALLOW_LOCAL", "")

	req := httptest.NewRequest(http.MethodGet, "http://198.51.100.10/search", nil)
	req.URL.Host = "127.0.0.1:9999"
	err := customSearchHTTPClient(time.Second).CheckRedirect(req, []*http.Request{
		httptest.NewRequest(http.MethodGet, "http://198.51.100.10/search", nil),
	})
	if err == nil {
		t.Fatal("expected local custom search redirect to be blocked")
	}
	if !strings.Contains(err.Error(), "CUSTOM_SEARCH_ENDPOINT") {
		t.Fatalf("redirect error = %v, want CUSTOM_SEARCH_ENDPOINT message", err)
	}

	if _, err := customSearchDialTargets(context.Background(), "127.0.0.1:9999"); err == nil {
		t.Fatal("expected local custom search dial target to be blocked")
	}
}

func TestDesktopStateChangingRequestOriginGuard(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		requestURL string
		setup      func(*http.Request)
		wantErr    bool
	}{
		{
			name:    "missing origin and header",
			wantErr: true,
		},
		{
			name: "same origin",
			setup: func(r *http.Request) {
				r.Header.Set("Origin", "http://127.0.0.1:61013")
			},
		},
		{
			name:       "ipv6 same origin",
			requestURL: "http://[::1]:61013/api/v1/settings",
			setup: func(r *http.Request) {
				r.Header.Set("Origin", "http://[::1]:61013")
			},
		},
		{
			name: "same origin referer",
			setup: func(r *http.Request) {
				r.Header.Set("Referer", "http://127.0.0.1:61013/settings")
			},
		},
		{
			name: "desktop request header",
			setup: func(r *http.Request) {
				r.Header.Set(desktopRequestHeader, desktopRequestHeaderSet)
			},
		},
		{
			name:   "safe method without origin or header",
			method: http.MethodGet,
		},
		{
			name: "same host different port",
			setup: func(r *http.Request) {
				r.Header.Set("Origin", "http://127.0.0.1:5173")
			},
			wantErr: true,
		},
		{
			name: "same host default port differs",
			setup: func(r *http.Request) {
				r.Header.Set("Origin", "http://127.0.0.1")
			},
			wantErr: true,
		},
		{
			name: "cross origin with desktop header",
			setup: func(r *http.Request) {
				r.Header.Set("Origin", "http://127.0.0.1:3000")
				r.Header.Set(desktopRequestHeader, desktopRequestHeaderSet)
			},
			wantErr: true,
		},
		{
			name: "cross origin referer",
			setup: func(r *http.Request) {
				r.Header.Set("Referer", "http://127.0.0.1:3000/settings")
			},
			wantErr: true,
		},
		{
			name: "malformed origin",
			setup: func(r *http.Request) {
				r.Header.Set("Origin", "http://[::1")
			},
			wantErr: true,
		},
		{
			name: "malformed referer",
			setup: func(r *http.Request) {
				r.Header.Set("Referer", "://not-a-url")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			method := tt.method
			if method == "" {
				method = http.MethodPost
			}
			requestURL := tt.requestURL
			if requestURL == "" {
				requestURL = "http://127.0.0.1:61013/api/v1/settings"
			}
			req := httptest.NewRequest(method, requestURL, nil)
			if tt.setup != nil {
				tt.setup(req)
			}

			err := validateDesktopStateChangingRequest(req)
			if tt.wantErr && err == nil {
				t.Fatal("expected request to be rejected")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("validateDesktopStateChangingRequest() error = %v", err)
			}
		})
	}
}

func TestHandlerFailsClosedForExactAPIPath(t *testing.T) {
	server := &Server{Token: "test-token"}
	req := httptest.NewRequest(http.MethodGet, "/api", nil)
	req.AddCookie(&http.Cookie{Name: "token", Value: "test-token"})
	rr := httptest.NewRecorder()

	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNotFound)
	}
	if !strings.Contains(rr.Body.String(), "API route not found") {
		t.Fatalf("body = %q, want API route not found", rr.Body.String())
	}
}

func TestHandlerRejectsDesktopStateChangeWithoutOrigin(t *testing.T) {
	server := &Server{Token: "test-token"}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/app-data/reset", nil)
	req.AddCookie(&http.Cookie{Name: "token", Value: "test-token"})
	rr := httptest.NewRecorder()

	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusForbidden)
	}
	if !strings.Contains(rr.Body.String(), "Request origin is required") {
		t.Fatalf("body = %q, want origin error", rr.Body.String())
	}
}

func TestCORSPreflightAllowsLocalDesktopRequestHeader(t *testing.T) {
	t.Setenv("OLLAMA_CORS", "1")

	server := &Server{Token: "test-token"}
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/settings", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", desktopRequestHeader)
	rr := httptest.NewRecorder()

	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%q", rr.Code, http.StatusOK, rr.Body.String())
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want localhost origin", got)
	}
	if !strings.Contains(rr.Header().Get("Access-Control-Allow-Headers"), desktopRequestHeader) {
		t.Fatalf("Access-Control-Allow-Headers = %q, want %s", rr.Header().Get("Access-Control-Allow-Headers"), desktopRequestHeader)
	}
}

func TestCORSPreflightRejectsDisallowedOrigin(t *testing.T) {
	t.Setenv("OLLAMA_CORS", "1")

	server := &Server{Token: "test-token"}
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/settings", nil)
	req.Header.Set("Origin", "https://example.test")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", desktopRequestHeader)
	rr := httptest.NewRecorder()

	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusForbidden)
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want empty", got)
	}
}

func TestHandlePostApiCloudSetting(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	t.Setenv("USERPROFILE", tmpHome)
	t.Setenv("OLLAMA_NO_CLOUD", "")

	testStore := &store.Store{
		DBPath: filepath.Join(t.TempDir(), "db.sqlite"),
	}
	defer testStore.Close()

	restartCount := 0
	server := &Server{
		Store: testStore,
		Restart: func() {
			restartCount++
		},
	}

	for _, tc := range []struct {
		name        string
		body        string
		wantEnabled bool
	}{
		{name: "disable cloud", body: `{"enabled": false}`, wantEnabled: false},
		{name: "enable cloud", body: `{"enabled": true}`, wantEnabled: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/v1/cloud", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()

			if err := server.cloudSetting(rr, req); err != nil {
				t.Fatalf("cloudSetting() error = %v", err)
			}
			if rr.Code != http.StatusOK {
				t.Fatalf("cloudSetting() status = %d, want %d", rr.Code, http.StatusOK)
			}

			var got map[string]any
			if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
				t.Fatalf("cloudSetting() invalid response JSON: %v", err)
			}
			if got["disabled"] != !tc.wantEnabled {
				t.Fatalf("response disabled = %v, want %v", got["disabled"], !tc.wantEnabled)
			}

			disabled, err := testStore.CloudDisabled()
			if err != nil {
				t.Fatalf("CloudDisabled() error = %v", err)
			}
			if gotEnabled := !disabled; gotEnabled != tc.wantEnabled {
				t.Fatalf("cloud enabled = %v, want %v", gotEnabled, tc.wantEnabled)
			}
		})
	}

	if restartCount != 2 {
		t.Fatalf("Restart called %d times, want 2", restartCount)
	}
}

func TestHandleGetApiCloudSetting(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	t.Setenv("USERPROFILE", tmpHome)
	t.Setenv("OLLAMA_NO_CLOUD", "")

	testStore := &store.Store{
		DBPath: filepath.Join(t.TempDir(), "db.sqlite"),
	}
	defer testStore.Close()

	if err := testStore.SetCloudEnabled(false); err != nil {
		t.Fatalf("SetCloudEnabled(false) error = %v", err)
	}

	server := &Server{
		Store:   testStore,
		Restart: func() {},
	}

	req := httptest.NewRequest("GET", "/api/v1/cloud", nil)
	rr := httptest.NewRecorder()
	if err := server.getCloudSetting(rr, req); err != nil {
		t.Fatalf("getCloudSetting() error = %v", err)
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("getCloudSetting() status = %d, want %d", rr.Code, http.StatusOK)
	}

	var got map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("getCloudSetting() invalid response JSON: %v", err)
	}
	if got["disabled"] != true {
		t.Fatalf("response disabled = %v, want true", got["disabled"])
	}
	if got["source"] != "config" {
		t.Fatalf("response source = %v, want config", got["source"])
	}
}

func TestAPIThinkValuePreservesExplicitFalse(t *testing.T) {
	got := apiThinkValue(false)
	if got == nil {
		t.Fatal("apiThinkValue(false) = nil, want explicit false")
	}
	if got.Value != false {
		t.Fatalf("apiThinkValue(false).Value = %v, want false", got.Value)
	}

	got = apiThinkValue("none")
	if got == nil {
		t.Fatal(`apiThinkValue("none") = nil, want explicit false`)
	}
	if got.Value != false {
		t.Fatalf(`apiThinkValue("none").Value = %v, want false`, got.Value)
	}
}

func TestChatInfoAutoTitle(t *testing.T) {
	longPrompt := strings.Repeat("word ", 30)
	normalizedLongPrompt := strings.Join(strings.Fields(longPrompt), " ")
	truncatedLongPrompt := string([]rune(normalizedLongPrompt)[:61]) + "..."

	for _, tc := range []struct {
		name string
		chat store.Chat
		want string
	}{
		{
			name: "uses saved title",
			chat: store.Chat{
				ID:    "saved",
				Title: "Renamed chat",
				Messages: []store.Message{
					store.NewMessage("user", "original prompt", nil),
				},
			},
			want: "Renamed chat",
		},
		{
			name: "uses first user prompt",
			chat: store.Chat{
				ID: "prompt",
				Messages: []store.Message{
					store.NewMessage("user", "  explain   local models  ", nil),
				},
			},
			want: "explain local models",
		},
		{
			name: "uses first attachment when prompt is empty",
			chat: store.Chat{
				ID: "attachment",
				Messages: []store.Message{
					store.NewMessage("user", "", &store.MessageOptions{
						Attachments: []store.File{
							{Filename: "image.png", Data: []byte("image")},
							{Filename: "notes.txt", Data: []byte("notes")},
						},
					}),
				},
			},
			want: "image.png +1",
		},
		{
			name: "truncates long prompt",
			chat: store.Chat{
				ID: "long",
				Messages: []store.Message{
					store.NewMessage("user", longPrompt, nil),
				},
			},
			want: truncatedLongPrompt,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := chatInfoFromChat(tc.chat).Title; got != tc.want {
				t.Fatalf("chatInfoFromChat().Title = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestBuildChatRequestAddsDesktopToolGuidance(t *testing.T) {
	chat := &store.Chat{
		ID: "chat",
		Messages: []store.Message{
			store.NewMessage("user", "What is in the app/tools folder?", nil),
		},
	}

	req, err := (&Server{}).buildChatRequest(chat, "test-model", false, []map[string]any{
		{
			"name":        "desktop.list_files",
			"description": "List files",
			"schema":      map[string]any{"type": "object"},
		},
	}, contextRequestSettings{})
	if err != nil {
		t.Fatalf("buildChatRequest returned error: %v", err)
	}
	if len(req.Messages) < 2 {
		t.Fatalf("expected tool guidance plus user message, got %#v", req.Messages)
	}
	if req.Messages[0].Role != "system" || !strings.Contains(req.Messages[0].Content, "desktop.list_files") {
		t.Fatalf("expected desktop tool guidance, got %#v", req.Messages[0])
	}
	if req.Messages[1].Role != "user" || req.Messages[1].Content != "What is in the app/tools folder?" {
		t.Fatalf("expected original user message after guidance, got %#v", req.Messages[1])
	}
}

func TestAuthenticationMiddleware(t *testing.T) {
	tests := []struct {
		name         string
		method       string
		contentType  string
		tokenCookie  string
		serverToken  string
		wantStatus   int
		wantError    string
		setupRequest func(*http.Request)
	}{
		{
			name:        "missing token cookie",
			method:      "GET",
			tokenCookie: "",
			serverToken: "test-token-123",
			wantStatus:  http.StatusForbidden,
			wantError:   "Token is required",
		},
		{
			name:        "invalid token value",
			method:      "GET",
			tokenCookie: "wrong-token",
			serverToken: "test-token-123",
			wantStatus:  http.StatusForbidden,
			wantError:   "Token is required",
		},
		{
			name:        "valid token - GET request",
			method:      "GET",
			tokenCookie: "test-token-123",
			serverToken: "test-token-123",
			wantStatus:  http.StatusOK,
			wantError:   "",
		},
		{
			name:        "valid token - POST with application/json",
			method:      "POST",
			contentType: "application/json",
			tokenCookie: "test-token-123",
			serverToken: "test-token-123",
			wantStatus:  http.StatusOK,
			wantError:   "",
		},
		{
			name:        "POST without Content-Type header",
			method:      "POST",
			contentType: "",
			tokenCookie: "test-token-123",
			serverToken: "test-token-123",
			wantStatus:  http.StatusForbidden,
			wantError:   "Content-Type must be application/json",
		},
		{
			name:        "POST with wrong Content-Type",
			method:      "POST",
			contentType: "text/plain",
			tokenCookie: "test-token-123",
			serverToken: "test-token-123",
			wantStatus:  http.StatusForbidden,
			wantError:   "Content-Type must be application/json",
		},
		{
			name:        "OPTIONS request (CORS preflight) - should bypass auth",
			method:      "OPTIONS",
			tokenCookie: "",
			serverToken: "test-token-123",
			wantStatus:  http.StatusOK,
			wantError:   "",
			setupRequest: func(r *http.Request) {
				// Simulate CORS being enabled
				// Note: This assumes CORS() returns true in test environment
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create a test handler that just returns 200 OK if auth passes
			testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
			})

			// Create server with test token
			server := &Server{
				Token: tt.serverToken,
			}

			// Get the authentication middleware by calling Handler()
			// We need to wrap our test handler with the auth middleware
			handler := server.Handler()

			// Create a test router to simulate the authentication middleware
			mux := http.NewServeMux()
			mux.Handle("/test", handler)

			// But since Handler() returns the full router, we'll need a different approach
			// Let's create a minimal handler that includes just the auth logic
			authHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Add CORS headers for dev work
				if r.Method == "OPTIONS" {
					w.WriteHeader(http.StatusOK)
					return
				}

				if r.Method == "POST" && r.Header.Get("Content-Type") != "application/json" {
					w.WriteHeader(http.StatusForbidden)
					json.NewEncoder(w).Encode(map[string]string{"error": "Content-Type must be application/json"})
					return
				}

				cookie, err := r.Cookie("token")
				if err != nil {
					w.WriteHeader(http.StatusForbidden)
					json.NewEncoder(w).Encode(map[string]string{"error": "Token is required"})
					return
				}

				if cookie.Value != server.Token {
					w.WriteHeader(http.StatusForbidden)
					json.NewEncoder(w).Encode(map[string]string{"error": "Token is required"})
					return
				}

				// If auth passes, call the test handler
				testHandler.ServeHTTP(w, r)
			})

			// Create test request
			req := httptest.NewRequest(tt.method, "/test", nil)

			// Set Content-Type if provided
			if tt.contentType != "" {
				req.Header.Set("Content-Type", tt.contentType)
			}

			// Set token cookie if provided
			if tt.tokenCookie != "" {
				req.AddCookie(&http.Cookie{
					Name:  "token",
					Value: tt.tokenCookie,
				})
			}

			// Run any additional setup
			if tt.setupRequest != nil {
				tt.setupRequest(req)
			}

			// Create response recorder
			rr := httptest.NewRecorder()

			// Serve the request
			authHandler.ServeHTTP(rr, req)

			// Check status code
			if rr.Code != tt.wantStatus {
				t.Errorf("handler returned wrong status code: got %v want %v", rr.Code, tt.wantStatus)
			}

			// Check error message if expected
			if tt.wantError != "" {
				var response map[string]string
				if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
					t.Fatalf("failed to decode response body: %v", err)
				}

				if response["error"] != tt.wantError {
					t.Errorf("handler returned wrong error message: got %v want %v", response["error"], tt.wantError)
				}
			}
		})
	}
}

func TestPackagedApiRoutesRequireToken(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
	}{
		{
			name:   "desktop app API",
			method: http.MethodGet,
			path:   "/api/v1/settings",
		},
		{
			name:   "security status API",
			method: http.MethodGet,
			path:   "/api/v1/security",
		},
		{
			name:   "search API",
			method: http.MethodGet,
			path:   "/api/search?q=ollama",
		},
		{
			name:   "core proxy tags API",
			method: http.MethodGet,
			path:   "/api/tags",
		},
		{
			name:   "core proxy chat API",
			method: http.MethodPost,
			path:   "/api/chat",
		},
		{
			name:   "core proxy pull API",
			method: http.MethodPost,
			path:   "/api/pull",
		},
		{
			name:   "core proxy create API",
			method: http.MethodPost,
			path:   "/api/create",
		},
		{
			name:   "core proxy delete API",
			method: http.MethodDelete,
			path:   "/api/delete",
		},
		{
			name:   "core proxy copy API",
			method: http.MethodPost,
			path:   "/api/copy",
		},
		{
			name:   "core proxy push API",
			method: http.MethodPost,
			path:   "/api/push",
		},
		{
			name:   "core proxy blob upload API",
			method: http.MethodPost,
			path:   "/api/blobs/sha256:abc123",
		},
		{
			name:   "unknown API route",
			method: http.MethodGet,
			path:   "/api/not-real",
		},
	}

	handler := (&Server{Token: "secret-token"}).Handler()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if rr.Code != http.StatusForbidden {
				t.Fatalf("expected status %d, got %d", http.StatusForbidden, rr.Code)
			}

			var response map[string]string
			if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
				t.Fatalf("failed to decode response body: %v", err)
			}
			if response["error"] != "Token is required" {
				t.Fatalf("expected token error, got %#v", response)
			}
		})
	}
}

func TestUnknownApiRoutesFailClosed(t *testing.T) {
	handler := (&Server{Token: "secret-token"}).Handler()
	req := httptest.NewRequest(http.MethodGet, "/api/not-real", nil)
	req.AddCookie(&http.Cookie{Name: "token", Value: "secret-token"})
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, rr.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if response["error"] != "API route not found" {
		t.Fatalf("expected fail-closed API error, got %#v", response)
	}
}

func TestSecurityStatusReportsSafeDesktopDefaults(t *testing.T) {
	previousTimeout := securityStatusTimeout
	securityStatusTimeout = 200 * time.Millisecond
	t.Cleanup(func() { securityStatusTimeout = previousTimeout })

	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	t.Setenv("USERPROFILE", tmpHome)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/version" {
			t.Fatalf("unexpected upstream path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"test"}`))
	}))
	defer upstream.Close()

	t.Setenv("OLLAMA_HOST", upstream.URL)
	t.Setenv("OLLAMA_PROXY_ALLOWED_UPSTREAMS", "127.0.0.1,localhost,::1")
	t.Setenv("OLLAMA_PROXY_ALLOW_MODEL_MUTATION", "")
	t.Setenv("OLLAMA_PROXY_ALLOW_PUSH", "")

	testStore := &store.Store{DBPath: filepath.Join(t.TempDir(), "db.sqlite")}
	defer testStore.Close()
	if err := testStore.SetCloudEnabled(false); err != nil {
		t.Fatalf("SetCloudEnabled(false) error = %v", err)
	}

	handler := (&Server{Token: "secret-token", Store: testStore}).Handler()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/security", nil)
	req.AddCookie(&http.Cookie{Name: "token", Value: "secret-token"})
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%q", http.StatusOK, rr.Code, rr.Body.String())
	}

	var status responses.SecurityStatusResponse
	if err := json.NewDecoder(rr.Body).Decode(&status); err != nil {
		t.Fatalf("failed to decode security status: %v", err)
	}

	if status.Mode != "desktop" {
		t.Fatalf("Mode = %q, want desktop", status.Mode)
	}
	if !status.CoreAPIReachable || !status.CoreAPIHostLocal || !status.CoreAPIHostAllowed {
		t.Fatalf("unexpected core status: %#v", status)
	}
	if !status.DesktopAuthEnabled || status.DevMode {
		t.Fatalf("unexpected auth/dev status: %#v", status)
	}
	if !status.LocalOnlyOfflineMode || !status.CloudDisabled || status.CloudSource != "config" {
		t.Fatalf("unexpected cloud status: %#v", status)
	}
	if status.NetworkExposureAllowed || status.ModelMutationProxyEnabled || status.PushProxyEnabled || status.CustomBrowserOrigins {
		t.Fatalf("unexpected unsafe flags: %#v", status)
	}
	if !status.BrowserOriginsEnabled {
		t.Fatalf("BrowserOriginsEnabled = false, want true for default core origins")
	}
	if len(status.Warnings) != 1 || status.Warnings[0].Code != "default_browser_origins" {
		t.Fatalf("expected only default browser origins warning, got %#v", status.Warnings)
	}
}

func TestSecurityStatusWarnsOnUnsafeConfiguration(t *testing.T) {
	previousTimeout := securityStatusTimeout
	securityStatusTimeout = 10 * time.Millisecond
	t.Cleanup(func() { securityStatusTimeout = previousTimeout })

	t.Setenv("OLLAMA_HOST", "http://example.com:11434")
	t.Setenv("OLLAMA_ALLOW_NETWORK_EXPOSURE", "true")
	t.Setenv("OLLAMA_PROXY_ALLOW_MODEL_MUTATION", "true")
	t.Setenv("OLLAMA_PROXY_ALLOW_PUSH", "true")
	t.Setenv("OLLAMA_ORIGINS", "*")

	testStore := &store.Store{DBPath: filepath.Join(t.TempDir(), "db.sqlite")}
	defer testStore.Close()
	if err := testStore.SetSettings(store.Settings{Expose: true, Browser: true}); err != nil {
		t.Fatalf("SetSettings() error = %v", err)
	}

	status := (&Server{Dev: true, Store: testStore}).securityStatus(t.Context())

	if status.CoreAPIHostLocal || status.CoreAPIHostAllowed || status.CoreAPIReachable {
		t.Fatalf("unexpected core status: %#v", status)
	}
	if status.DesktopAuthEnabled {
		t.Fatalf("DesktopAuthEnabled = true, want false")
	}
	if !status.NetworkExposureAllowed || !status.ModelMutationProxyEnabled || !status.PushProxyEnabled || !status.BrowserOriginsEnabled || !status.CustomBrowserOrigins {
		t.Fatalf("expected unsafe flags enabled: %#v", status)
	}

	wantWarnings := map[string]bool{
		"unsafe_upstream":       false,
		"desktop_auth_disabled": false,
		"network_exposure":      false,
		"browser_origins":       false,
		"model_mutation_proxy":  false,
		"push_proxy":            false,
	}
	for _, warning := range status.Warnings {
		if _, ok := wantWarnings[warning.Code]; ok {
			wantWarnings[warning.Code] = true
		}
	}
	for code, seen := range wantWarnings {
		if !seen {
			t.Fatalf("missing warning %q in %#v", code, status.Warnings)
		}
	}
}

func TestSecurityStatusReportsAppDataEncryptionKeyFailure(t *testing.T) {
	previousTimeout := securityStatusTimeout
	securityStatusTimeout = time.Millisecond
	t.Cleanup(func() { securityStatusTimeout = previousTimeout })

	dbPath := filepath.Join(t.TempDir(), "db.sqlite")
	t.Setenv("OLLAMA_APP_DATA_KEY", "correct horse battery staple")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")

	initialStore := &store.Store{DBPath: dbPath}
	if _, err := initialStore.Settings(); err != nil {
		t.Fatalf("initialize encrypted store: %v", err)
	}
	if err := initialStore.Close(); err != nil {
		t.Fatalf("close encrypted store: %v", err)
	}

	t.Setenv("OLLAMA_APP_DATA_KEY", "wrong key")
	lockedStore := &store.Store{DBPath: dbPath}
	status := (&Server{Dev: true, Store: lockedStore}).securityStatus(t.Context())

	if !status.AppDataEncrypted || status.AppDataEncryptionState != string(store.AppDataEncryptionStateKeyInvalid) {
		t.Fatalf("unexpected app data encryption status: %#v", status)
	}
	if status.AppDataEncryptionError == "" {
		t.Fatalf("expected app data encryption error, got %#v", status)
	}
	foundWarning := false
	for _, warning := range status.Warnings {
		if warning.Code == "app_data_encryption_key_invalid" {
			foundWarning = true
			break
		}
	}
	if !foundWarning {
		t.Fatalf("missing app data encryption warning in %#v", status.Warnings)
	}

	handler := (&Server{Token: "secret-token", Store: lockedStore}).Handler()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	req.AddCookie(&http.Cookie{Name: "token", Value: "secret-token"})
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusLocked {
		t.Fatalf("expected status %d, got %d body=%q", http.StatusLocked, rr.Code, rr.Body.String())
	}
	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["code"] != "app_data_encryption_locked" || !strings.Contains(body["error"], "OLLAMA_APP_DATA_KEY") {
		t.Fatalf("unexpected encryption error body: %#v", body)
	}

	resetReq := httptest.NewRequest(http.MethodPost, "/api/v1/app-data/reset", nil)
	markDesktopRequest(resetReq)
	resetReq.AddCookie(&http.Cookie{Name: "token", Value: "secret-token"})
	resetRR := httptest.NewRecorder()

	handler.ServeHTTP(resetRR, resetReq)

	if resetRR.Code != http.StatusOK {
		t.Fatalf("expected reset status %d, got %d body=%q", http.StatusOK, resetRR.Code, resetRR.Body.String())
	}
	var resetBody responses.AppDataResetResponse
	if err := json.NewDecoder(resetRR.Body).Decode(&resetBody); err != nil {
		t.Fatalf("decode reset body: %v", err)
	}
	if len(resetBody.BackupPaths) == 0 {
		t.Fatalf("expected reset to return backup paths, got %#v", resetBody)
	}

	settingsReq := httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	settingsReq.AddCookie(&http.Cookie{Name: "token", Value: "secret-token"})
	settingsRR := httptest.NewRecorder()
	handler.ServeHTTP(settingsRR, settingsReq)
	if settingsRR.Code != http.StatusOK {
		t.Fatalf("expected settings after reset status %d, got %d body=%q", http.StatusOK, settingsRR.Code, settingsRR.Body.String())
	}
	if err := lockedStore.Close(); err != nil {
		t.Fatalf("close reset store: %v", err)
	}
}

func TestProxyDangerousRoutesBlockedByDefault(t *testing.T) {
	t.Setenv("OLLAMA_PROXY_ALLOW_MODEL_MUTATION", "")
	t.Setenv("OLLAMA_PROXY_ALLOW_PUSH", "")

	tests := []struct {
		method string
		path   string
		env    string
	}{
		{http.MethodPost, "/api/pull", "OLLAMA_PROXY_ALLOW_MODEL_MUTATION"},
		{http.MethodPost, "/api/create", "OLLAMA_PROXY_ALLOW_MODEL_MUTATION"},
		{http.MethodPost, "/api/copy", "OLLAMA_PROXY_ALLOW_MODEL_MUTATION"},
		{http.MethodDelete, "/api/delete", "OLLAMA_PROXY_ALLOW_MODEL_MUTATION"},
		{http.MethodPost, "/api/blobs/sha256:abc123", "OLLAMA_PROXY_ALLOW_MODEL_MUTATION"},
		{http.MethodPost, "/api/push", "OLLAMA_PROXY_ALLOW_PUSH"},
	}

	handler := (&Server{Token: "secret-token"}).Handler()
	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(`{"model":"test"}`))
			markDesktopRequest(req)
			req.AddCookie(&http.Cookie{Name: "token", Value: "secret-token"})
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if rr.Code != http.StatusForbidden {
				t.Fatalf("expected status %d, got %d", http.StatusForbidden, rr.Code)
			}

			var response map[string]string
			if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
				t.Fatalf("failed to decode response body: %v", err)
			}
			if !strings.Contains(response["error"], tt.env) {
				t.Fatalf("expected blocked route error to mention %s, got %#v", tt.env, response)
			}
		})
	}
}

func TestProxyAllowsSafeRoutesToLocalUpstream(t *testing.T) {
	var gotPaths atomic.Value
	gotPaths.Store([]string{})

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths := gotPaths.Load().([]string)
		gotPaths.Store(append(paths, r.Method+" "+r.URL.Path))

		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/version":
			_, _ = w.Write([]byte(`{"version":"test"}`))
		case "/api/tags":
			_, _ = w.Write([]byte(`{"models":[]}`))
		default:
			_, _ = w.Write([]byte(`{"ok":true}`))
		}
	}))
	defer upstream.Close()

	t.Setenv("OLLAMA_HOST", upstream.URL)
	t.Setenv("OLLAMA_PROXY_ALLOWED_UPSTREAMS", "127.0.0.1,localhost,::1")

	handler := (&Server{Token: "secret-token"}).Handler()
	tests := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/tags"},
		{http.MethodPost, "/api/chat"},
		{http.MethodPost, "/api/generate"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(`{"model":"test"}`))
			markDesktopRequest(req)
			req.AddCookie(&http.Cookie{Name: "token", Value: "secret-token"})
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("expected status %d, got %d body=%q", http.StatusOK, rr.Code, rr.Body.String())
			}
		})
	}
}

func TestProxyAllowsDangerousRoutesWithExplicitEnv(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/version" {
			_, _ = w.Write([]byte(`{"version":"test"}`))
			return
		}
		_, _ = w.Write([]byte(`{"path":` + strconv.Quote(r.URL.Path) + `}`))
	}))
	defer upstream.Close()

	t.Setenv("OLLAMA_HOST", upstream.URL)
	t.Setenv("OLLAMA_PROXY_ALLOWED_UPSTREAMS", "127.0.0.1,localhost,::1")
	t.Setenv("OLLAMA_PROXY_ALLOW_MODEL_MUTATION", "true")

	handler := (&Server{Token: "secret-token"}).Handler()
	req := httptest.NewRequest(http.MethodPost, "/api/pull", strings.NewReader(`{"model":"test"}`))
	markDesktopRequest(req)
	req.AddCookie(&http.Cookie{Name: "token", Value: "secret-token"})
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected model mutation route through, got %d body=%q", rr.Code, rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/push", strings.NewReader(`{"model":"test"}`))
	markDesktopRequest(req)
	req.AddCookie(&http.Cookie{Name: "token", Value: "secret-token"})
	rr = httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected push to remain blocked without push env, got %d", rr.Code)
	}

	t.Setenv("OLLAMA_PROXY_ALLOW_PUSH", "true")
	req = httptest.NewRequest(http.MethodPost, "/api/push", strings.NewReader(`{"model":"test"}`))
	markDesktopRequest(req)
	req.AddCookie(&http.Cookie{Name: "token", Value: "secret-token"})
	rr = httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected push route through with push env, got %d body=%q", rr.Code, rr.Body.String())
	}
}

func TestProxyRejectsRemoteUpstream(t *testing.T) {
	t.Setenv("OLLAMA_HOST", "http://example.com:11434")
	t.Setenv("OLLAMA_PROXY_ALLOWED_UPSTREAMS", "example.com,127.0.0.1,localhost")

	handler := (&Server{Token: "secret-token"}).Handler()
	req := httptest.NewRequest(http.MethodGet, "/api/tags", nil)
	req.AddCookie(&http.Cookie{Name: "token", Value: "secret-token"})
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("expected status %d, got %d body=%q", http.StatusBadGateway, rr.Code, rr.Body.String())
	}
}

func TestProxyRequestBodyLimit(t *testing.T) {
	handler := (&Server{Token: "secret-token"}).Handler()
	req := httptest.NewRequest(http.MethodPost, "/api/chat", strings.NewReader(`{}`))
	markDesktopRequest(req)
	req.ContentLength = maxProxyRequestBytes + 1
	req.AddCookie(&http.Cookie{Name: "token", Value: "secret-token"})
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected status %d, got %d", http.StatusRequestEntityTooLarge, rr.Code)
	}
}

func TestProxyLogsRedactSensitiveData(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	handler := (&Server{Token: "desktop-cookie-token", Logger: logger}).Handler()
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/pull?api_key=secret-query-key",
		strings.NewReader(`{"prompt":"secret prompt text","token":"secret-body-token","api_key":"secret-body-key"}`),
	)
	req.Header.Set("Authorization", "Bearer secret-authorization-token")
	markDesktopRequest(req)
	req.AddCookie(&http.Cookie{Name: "token", Value: "desktop-cookie-token"})
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected status %d, got %d", http.StatusForbidden, rr.Code)
	}

	output := logs.String()
	for _, secret := range []string{
		"secret-query-key",
		"secret prompt text",
		"secret-body-token",
		"secret-body-key",
		"secret-authorization-token",
		"desktop-cookie-token",
	} {
		if strings.Contains(output, secret) {
			t.Fatalf("proxy logs leaked %q in %s", secret, output)
		}
	}
}

func TestOllamaProxyDirectorStripsCredentials(t *testing.T) {
	t.Setenv("OLLAMA_API_TOKEN", "")
	target, err := url.Parse("http://127.0.0.1:11434")
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	proxy := (&Server{Logger: logger}).newOllamaReverseProxy(target)
	req := httptest.NewRequest(http.MethodPost, "http://desktop.local/api/chat", nil)
	req.Header.Set("Authorization", "Bearer secret")
	req.Header.Set("Cookie", "token=desktop-token")
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Proxy-Authorization", "Basic secret")
	req.Header.Set("X-Api-Key", "secret")
	req.Header.Set("X-Auth-Token", "secret")
	req.Header.Set("X-Keep", "value")

	proxy.Director(req)

	for _, header := range []string{"Authorization", "Cookie", "Origin", "Proxy-Authorization", "X-Api-Key", "X-Auth-Token"} {
		if got := req.Header.Get(header); got != "" {
			t.Fatalf("%s was forwarded as %q", header, got)
		}
	}
	if got := req.Header.Get("X-Keep"); got != "value" {
		t.Fatalf("X-Keep = %q, want value", got)
	}
	if req.URL.Host != target.Host {
		t.Fatalf("URL host = %q, want %q", req.URL.Host, target.Host)
	}
	if req.Host != target.Host {
		t.Fatalf("request Host = %q, want %q", req.Host, target.Host)
	}
}

func TestOllamaProxyDirectorAddsCoreAPIToken(t *testing.T) {
	t.Setenv("OLLAMA_API_TOKEN", "core-token")
	target, err := url.Parse("http://127.0.0.1:11434")
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	proxy := (&Server{Logger: logger}).newOllamaReverseProxy(target)
	req := httptest.NewRequest(http.MethodPost, "http://desktop.local/api/chat", nil)
	req.Header.Set("Authorization", "Bearer desktop-token")

	proxy.Director(req)

	if got := req.Header.Get("Authorization"); got != "Bearer core-token" {
		t.Fatalf("Authorization = %q, want core token", got)
	}
}

func TestOllamaProxyStripsUpstreamCORSHeaders(t *testing.T) {
	header := http.Header{}
	header.Add("Access-Control-Allow-Origin", "http://localhost:5173")
	header.Add("Access-Control-Allow-Credentials", "true")
	header.Add("Access-Control-Allow-Headers", "Content-Type")
	header.Add("Access-Control-Allow-Methods", "GET, POST")
	header.Add("Access-Control-Expose-Headers", "X-Test")
	header.Add("Access-Control-Max-Age", "600")
	header.Add("Vary", "Origin")
	header.Add("Vary", "Accept-Encoding, Origin")
	header.Add("Vary", "Accept-Language")
	header.Add("Content-Type", "application/json")

	stripUpstreamCORSHeaders(header)

	for _, key := range []string{
		"Access-Control-Allow-Origin",
		"Access-Control-Allow-Credentials",
		"Access-Control-Allow-Headers",
		"Access-Control-Allow-Methods",
		"Access-Control-Expose-Headers",
		"Access-Control-Max-Age",
	} {
		if got := header.Values(key); len(got) > 0 {
			t.Fatalf("%s was not stripped: %#v", key, got)
		}
	}

	if got := header.Values("Vary"); strings.Join(got, ",") != "Accept-Encoding,Accept-Language" {
		t.Fatalf("Vary = %#v, want Accept-Encoding and Accept-Language", got)
	}
	if got := header.Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
}

func TestUserAgent(t *testing.T) {
	ua := userAgent()

	// The userAgent function should return a string in the format:
	// "ollama/version (arch os) app/version Go/goversion"
	// Example: "ollama/v0.1.28 (amd64 darwin) Go/go1.21.0"

	if ua == "" {
		t.Fatal("userAgent returned empty string")
	}

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("User-Agent", ua)

	// This is a copy of the logic ollama.com uses to parse the user agent
	clientInfoFromRequest := func(r *http.Request) struct {
		Product    string
		Version    string
		OS         string
		Arch       string
		AppVersion string
	} {
		product, rest, _ := strings.Cut(r.UserAgent(), " ")
		client, version, ok := strings.Cut(product, "/")
		if !ok {
			return struct {
				Product    string
				Version    string
				OS         string
				Arch       string
				AppVersion string
			}{}
		}

		if version != "" && version[0] != 'v' {
			version = "v" + version
		}

		arch, rest, _ := strings.Cut(rest, " ")
		arch = strings.Trim(arch, "(")
		os, rest, _ := strings.Cut(rest, ")")

		var appVersion string
		if strings.Contains(rest, "app/") {
			_, appPart, found := strings.Cut(rest, "app/")
			if found {
				appVersion = strings.Fields(strings.TrimSpace(appPart))[0]
				if appVersion != "" && appVersion[0] != 'v' {
					appVersion = "v" + appVersion
				}
			}
		}

		return struct {
			Product    string
			Version    string
			OS         string
			Arch       string
			AppVersion string
		}{
			Product:    client,
			Version:    version,
			OS:         os,
			Arch:       arch,
			AppVersion: appVersion,
		}
	}

	info := clientInfoFromRequest(req)
	if info.Product != "ollama" {
		t.Errorf("Expected Product to be 'ollama', got '%s'", info.Product)
	}

	if info.Version != "" && info.Version[0] != 'v' {
		t.Errorf("Expected Version to start with 'v', got '%s'", info.Version)
	}

	expectedOS := runtime.GOOS
	if info.OS != expectedOS {
		t.Errorf("Expected OS to be '%s', got '%s'", expectedOS, info.OS)
	}

	expectedArch := runtime.GOARCH
	if info.Arch != expectedArch {
		t.Errorf("Expected Arch to be '%s', got '%s'", expectedArch, info.Arch)
	}

	if info.AppVersion != "" && info.AppVersion[0] != 'v' {
		t.Errorf("Expected AppVersion to start with 'v', got '%s'", info.AppVersion)
	}

	t.Logf("User Agent: %s", ua)
	t.Logf("Parsed - Product: %s, Version: %s, OS: %s, Arch: %s",
		info.Product, info.Version, info.OS, info.Arch)
}

func TestUserAgentTransport(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte(r.Header.Get("User-Agent")))
	}))
	defer ts.Close()
	server := &Server{}

	client := server.httpClient()
	resp, err := client.Get(ts.URL)
	if err != nil {
		t.Fatalf("Failed to make request: %v", err)
	}
	defer resp.Body.Close()

	// In this case the User-Agent is the response body, as the server just echoes it back
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("Failed to read response: %v", err)
	}

	receivedUA := string(body)
	expectedUA := userAgent()

	if receivedUA != expectedUA {
		t.Errorf("User-Agent mismatch\nExpected: %s\nReceived: %s", expectedUA, receivedUA)
	}

	if !strings.HasPrefix(receivedUA, "ollama/") {
		t.Errorf("User-Agent should start with 'ollama/', got: %s", receivedUA)
	}

	t.Logf("User-Agent transport successfully set: %s", receivedUA)
}

func TestInferenceClientUsesUserAgent(t *testing.T) {
	var gotUserAgent atomic.Value
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserAgent.Store(r.Header.Get("User-Agent"))
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
	}))
	defer ts.Close()

	t.Setenv("OLLAMA_HOST", ts.URL)

	server := &Server{}
	client := server.inferenceClient()

	_, err := client.Show(context.Background(), &api.ShowRequest{Model: "test"})
	if err != nil {
		t.Fatalf("show request failed: %v", err)
	}

	receivedUA, _ := gotUserAgent.Load().(string)
	expectedUA := userAgent()

	if receivedUA != expectedUA {
		t.Errorf("User-Agent mismatch\nExpected: %s\nReceived: %s", expectedUA, receivedUA)
	}
}

type testAppTool struct{}

func (testAppTool) Name() string {
	return "test_tool"
}

func (testAppTool) Description() string {
	return "Test tool"
}

func (testAppTool) Schema() map[string]any {
	return map[string]any{
		"type":       "object",
		"properties": map[string]any{},
	}
}

func (testAppTool) Execute(context.Context, map[string]any) (any, string, error) {
	return map[string]any{"ok": true}, "ok", nil
}

func (testAppTool) Prompt() string {
	return ""
}

func TestSupportsBrowserTools(t *testing.T) {
	tests := []struct {
		model string
		want  bool
	}{
		{"gpt-oss", true},
		{"gpt-oss-latest", true},
		{"GPT-OSS", true},
		{"Gpt-Oss-v2", true},
		{"qwen3", false},
		{"deepseek-v3", false},
		{"llama3.3", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			if got := supportsBrowserTools(tt.model); got != tt.want {
				t.Errorf("supportsBrowserTools(%q) = %v, want %v", tt.model, got, tt.want)
			}
		})
	}
}

func TestWebSearchToolRegistration(t *testing.T) {
	// Validates that the capability-gating logic in chat() correctly
	// decides which tools to register based on model capabilities and
	// the web search flag.
	tests := []struct {
		name             string
		webSearchEnabled bool
		hasToolsCap      bool
		model            string
		wantBrowser      bool // expects browser tools (gpt-oss)
		wantWebSearch    bool // expects basic web search/fetch tools
		wantNone         bool // expects no tools registered
	}{
		{
			name:             "web search enabled with tools capability - browser model",
			webSearchEnabled: true,
			hasToolsCap:      true,
			model:            "gpt-oss-latest",
			wantBrowser:      true,
		},
		{
			name:             "web search enabled with tools capability - non-browser model",
			webSearchEnabled: true,
			hasToolsCap:      true,
			model:            "qwen3",
			wantWebSearch:    true,
		},
		{
			name:             "web search enabled without tools capability",
			webSearchEnabled: true,
			hasToolsCap:      false,
			model:            "llama3.3",
			wantNone:         true,
		},
		{
			name:             "web search disabled with tools capability",
			webSearchEnabled: false,
			hasToolsCap:      true,
			model:            "qwen3",
			wantNone:         true,
		},
		{
			name:             "web search disabled without tools capability",
			webSearchEnabled: false,
			hasToolsCap:      false,
			model:            "llama3.3",
			wantNone:         true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Replicate the decision logic from chat() handler
			gotBrowser := false
			gotWebSearch := false

			if tt.webSearchEnabled && tt.hasToolsCap {
				if supportsBrowserTools(tt.model) {
					gotBrowser = true
				} else {
					gotWebSearch = true
				}
			}

			if tt.wantBrowser && !gotBrowser {
				t.Error("expected browser tools to be registered")
			}
			if tt.wantWebSearch && !gotWebSearch {
				t.Error("expected web search tools to be registered")
			}
			if tt.wantNone && (gotBrowser || gotWebSearch) {
				t.Error("expected no tools to be registered")
			}
			if !tt.wantBrowser && gotBrowser {
				t.Error("unexpected browser tools registered")
			}
			if !tt.wantWebSearch && gotWebSearch {
				t.Error("unexpected web search tools registered")
			}
		})
	}
}

func TestSettingsToggleAutoUpdateOff_CancelsDownload(t *testing.T) {
	testStore := &store.Store{
		DBPath: filepath.Join(t.TempDir(), "db.sqlite"),
	}
	defer testStore.Close()

	// Start with auto-update enabled
	settings, err := testStore.Settings()
	if err != nil {
		t.Fatal(err)
	}
	settings.AutoUpdateEnabled = true
	if err := testStore.SetSettings(settings); err != nil {
		t.Fatal(err)
	}

	upd := &updater.Updater{Store: &store.Store{
		DBPath: filepath.Join(t.TempDir(), "db2.sqlite"),
	}}
	defer upd.Store.Close()

	// We can't easily mock CancelOngoingDownload, but we can verify
	// the full settings handler flow works without error
	server := &Server{
		Store:   testStore,
		Restart: func() {},
		Updater: upd,
	}

	// Disable auto-update via settings API
	settings.AutoUpdateEnabled = false
	body, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("POST", "/api/v1/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	if err := server.settings(rr, req); err != nil {
		t.Fatalf("settings() error = %v", err)
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("settings() status = %d, want %d", rr.Code, http.StatusOK)
	}

	// Verify settings were saved with auto-update disabled
	saved, err := testStore.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if saved.AutoUpdateEnabled {
		t.Fatal("expected AutoUpdateEnabled to be false after toggle off")
	}
}

func TestSettingsToggleAutoUpdateOn_WithPendingUpdate_ShowsNotification(t *testing.T) {
	testStore := &store.Store{
		DBPath: filepath.Join(t.TempDir(), "db.sqlite"),
	}
	defer testStore.Close()

	// Start with auto-update disabled
	settings, err := testStore.Settings()
	if err != nil {
		t.Fatal(err)
	}
	settings.AutoUpdateEnabled = false
	if err := testStore.SetSettings(settings); err != nil {
		t.Fatal(err)
	}

	// Simulate that an update was previously downloaded
	oldVal := updater.UpdateDownloaded
	updater.UpdateDownloaded = true
	defer func() { updater.UpdateDownloaded = oldVal }()

	var notificationCalled atomic.Bool
	server := &Server{
		Store:   testStore,
		Restart: func() {},
		UpdateAvailableFunc: func() {
			notificationCalled.Store(true)
		},
	}

	// Re-enable auto-update via settings API
	settings.AutoUpdateEnabled = true
	body, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("POST", "/api/v1/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	if err := server.settings(rr, req); err != nil {
		t.Fatalf("settings() error = %v", err)
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("settings() status = %d, want %d", rr.Code, http.StatusOK)
	}

	if !notificationCalled.Load() {
		t.Fatal("expected UpdateAvailableFunc to be called when re-enabling with a downloaded update")
	}
}

func TestSettingsToggleAutoUpdateOn_NoPendingUpdate_TriggersCheck(t *testing.T) {
	testStore := &store.Store{
		DBPath: filepath.Join(t.TempDir(), "db.sqlite"),
	}
	defer testStore.Close()

	// Start with auto-update disabled
	settings, err := testStore.Settings()
	if err != nil {
		t.Fatal(err)
	}
	settings.AutoUpdateEnabled = false
	if err := testStore.SetSettings(settings); err != nil {
		t.Fatal(err)
	}

	// Ensure no pending update - clear both the downloaded flag and the stage dir
	oldVal := updater.UpdateDownloaded
	updater.UpdateDownloaded = false
	defer func() { updater.UpdateDownloaded = oldVal }()

	oldStageDir := updater.UpdateStageDir
	updater.UpdateStageDir = t.TempDir() // empty dir means IsUpdatePending() returns false
	defer func() { updater.UpdateStageDir = oldStageDir }()

	upd := &updater.Updater{Store: &store.Store{
		DBPath: filepath.Join(t.TempDir(), "db2.sqlite"),
	}}
	defer upd.Store.Close()

	// Initialize the checkNow channel by starting (and immediately stopping) the checker
	// so TriggerImmediateCheck doesn't panic on nil channel
	ctx, cancel := context.WithCancel(t.Context())
	upd.StartBackgroundUpdaterChecker(ctx, func(string) error { return nil })
	defer cancel()

	var notificationCalled atomic.Bool
	server := &Server{
		Store:   testStore,
		Restart: func() {},
		Updater: upd,
		UpdateAvailableFunc: func() {
			notificationCalled.Store(true)
		},
	}

	// Re-enable auto-update via settings API
	settings.AutoUpdateEnabled = true
	body, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("POST", "/api/v1/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	if err := server.settings(rr, req); err != nil {
		t.Fatalf("settings() error = %v", err)
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("settings() status = %d, want %d", rr.Code, http.StatusOK)
	}

	// UpdateAvailableFunc should NOT be called since there's no pending update
	if notificationCalled.Load() {
		t.Fatal("UpdateAvailableFunc should not be called when there is no pending update")
	}
}
