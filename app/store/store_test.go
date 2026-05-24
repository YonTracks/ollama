//go:build windows || darwin

package store

import (
	"path/filepath"
	"testing"
)

func TestStore(t *testing.T) {
	s, cleanup := setupTestStore(t)
	defer cleanup()

	t.Run("default id", func(t *testing.T) {
		// ID should be automatically generated
		id, err := s.ID()
		if err != nil {
			t.Fatal(err)
		}
		if id == "" {
			t.Error("expected non-empty ID")
		}

		// Verify ID is persisted
		id2, err := s.ID()
		if err != nil {
			t.Fatal(err)
		}
		if id != id2 {
			t.Errorf("expected ID %s, got %s", id, id2)
		}
	})

	t.Run("has completed first run", func(t *testing.T) {
		// Default should be false (hasn't completed first run yet)
		hasCompleted, err := s.HasCompletedFirstRun()
		if err != nil {
			t.Fatal(err)
		}
		if hasCompleted {
			t.Error("expected has completed first run to be false by default")
		}

		if err := s.SetHasCompletedFirstRun(true); err != nil {
			t.Fatal(err)
		}

		hasCompleted, err = s.HasCompletedFirstRun()
		if err != nil {
			t.Fatal(err)
		}
		if !hasCompleted {
			t.Error("expected has completed first run to be true")
		}
	})

	t.Run("settings", func(t *testing.T) {
		sc := Settings{
			Expose:     true,
			Browser:    true,
			Survey:     true,
			Models:     "/tmp/models",
			Agent:      true,
			Tools:      false,
			WorkingDir: "/tmp/work",
		}

		if err := s.SetSettings(sc); err != nil {
			t.Fatal(err)
		}

		loaded, err := s.Settings()
		if err != nil {
			t.Fatal(err)
		}
		// Compare fields individually since Models might get a default
		if loaded.Expose != sc.Expose || loaded.Browser != sc.Browser ||
			loaded.Agent != sc.Agent || loaded.Survey != sc.Survey ||
			loaded.Tools != sc.Tools || loaded.WorkingDir != sc.WorkingDir {
			t.Errorf("expected %v, got %v", sc, loaded)
		}
	})

	t.Run("settings default home view is launch", func(t *testing.T) {
		loaded, err := s.Settings()
		if err != nil {
			t.Fatal(err)
		}

		if loaded.LastHomeView != "launch" {
			t.Fatalf("expected default LastHomeView to be launch, got %q", loaded.LastHomeView)
		}
	})

	t.Run("settings empty home view falls back to launch", func(t *testing.T) {
		if err := s.SetSettings(Settings{LastHomeView: ""}); err != nil {
			t.Fatal(err)
		}

		loaded, err := s.Settings()
		if err != nil {
			t.Fatal(err)
		}

		if loaded.LastHomeView != "launch" {
			t.Fatalf("expected empty LastHomeView to fall back to launch, got %q", loaded.LastHomeView)
		}
	})

	t.Run("admin auth verifier persists in app metadata", func(t *testing.T) {
		initial, err := s.AdminAuthVerifier()
		if err != nil {
			t.Fatal(err)
		}
		if initial != "" {
			t.Fatalf("expected empty admin auth verifier, got %q", initial)
		}

		record := `{"version":1,"algorithm":"PBKDF2-SHA256","iterations":210000,"salt":"salt","verifier":"verifier","createdAt":"2026-05-24T00:00:00Z"}`
		if err := s.SetAdminAuthVerifier(record); err != nil {
			t.Fatal(err)
		}
		loaded, err := s.AdminAuthVerifier()
		if err != nil {
			t.Fatal(err)
		}
		if loaded != record {
			t.Fatalf("expected persisted admin auth verifier, got %q", loaded)
		}

		if err := s.DeleteAdminAuthVerifier(); err != nil {
			t.Fatal(err)
		}
		deleted, err := s.AdminAuthVerifier()
		if err != nil {
			t.Fatal(err)
		}
		if deleted != "" {
			t.Fatalf("expected deleted admin auth verifier, got %q", deleted)
		}
	})

	t.Run("settings disabled home view falls back to launch", func(t *testing.T) {
		if err := s.SetSettings(Settings{LastHomeView: "claude-desktop"}); err != nil {
			t.Fatal(err)
		}

		loaded, err := s.Settings()
		if err != nil {
			t.Fatal(err)
		}

		if loaded.LastHomeView != "launch" {
			t.Fatalf("expected disabled LastHomeView to fall back to launch, got %q", loaded.LastHomeView)
		}
	})

	t.Run("settings codex app home view is accepted", func(t *testing.T) {
		if err := s.SetSettings(Settings{LastHomeView: "codex-app"}); err != nil {
			t.Fatal(err)
		}

		loaded, err := s.Settings()
		if err != nil {
			t.Fatal(err)
		}

		if loaded.LastHomeView != "codex-app" {
			t.Fatalf("expected codex-app LastHomeView to be preserved, got %q", loaded.LastHomeView)
		}
	})

	t.Run("window size", func(t *testing.T) {
		if err := s.SetWindowSize(1024, 768); err != nil {
			t.Fatal(err)
		}

		width, height, err := s.WindowSize()
		if err != nil {
			t.Fatal(err)
		}
		if width != 1024 || height != 768 {
			t.Errorf("expected 1024x768, got %dx%d", width, height)
		}
	})

	t.Run("create and retrieve chat", func(t *testing.T) {
		chat := NewChat("test-chat-1")
		chat.Title = "Test Chat"
		searched := true

		chat.Messages = append(chat.Messages, NewMessage("user", "Hello", nil))
		chat.Messages = append(chat.Messages, NewMessage("assistant", "Hi there!", &MessageOptions{
			Model:             "llama4",
			WebSearchMode:     "auto",
			WebSearchProvider: "brave",
			WebSearchResults: []MessageSearchResult{
				{
					Title:   "Example result",
					URL:     "https://example.test/source",
					Content: "Snippet",
					Engine:  "brave",
				},
			},
			WebSearchReason:   "freshness or current-info signal",
			WebSearchSearched: &searched,
		}))

		if err := s.SetChat(*chat); err != nil {
			t.Fatalf("failed to save chat: %v", err)
		}

		retrieved, err := s.Chat("test-chat-1")
		if err != nil {
			t.Fatalf("failed to retrieve chat: %v", err)
		}

		if retrieved.ID != chat.ID {
			t.Errorf("expected ID %s, got %s", chat.ID, retrieved.ID)
		}
		if retrieved.Title != chat.Title {
			t.Errorf("expected title %s, got %s", chat.Title, retrieved.Title)
		}
		if len(retrieved.Messages) != 2 {
			t.Fatalf("expected 2 messages, got %d", len(retrieved.Messages))
		}
		if retrieved.Messages[0].Content != "Hello" {
			t.Errorf("expected first message 'Hello', got %s", retrieved.Messages[0].Content)
		}
		if retrieved.Messages[1].Content != "Hi there!" {
			t.Errorf("expected second message 'Hi there!', got %s", retrieved.Messages[1].Content)
		}
		if retrieved.Messages[1].WebSearchMode != "auto" ||
			retrieved.Messages[1].WebSearchProvider != "brave" ||
			retrieved.Messages[1].WebSearchSearched == nil ||
			!*retrieved.Messages[1].WebSearchSearched ||
			len(retrieved.Messages[1].WebSearchResults) != 1 ||
			retrieved.Messages[1].WebSearchResults[0].URL != "https://example.test/source" {
			t.Fatalf("expected web search metadata to persist, got %#v", retrieved.Messages[1])
		}
	})

	t.Run("list chats", func(t *testing.T) {
		chat2 := NewChat("test-chat-2")
		chat2.Title = "Another Chat"
		chat2.Messages = append(chat2.Messages, NewMessage("user", "Test", nil))

		if err := s.SetChat(*chat2); err != nil {
			t.Fatalf("failed to save chat: %v", err)
		}

		chats, err := s.Chats()
		if err != nil {
			t.Fatalf("failed to list chats: %v", err)
		}

		if len(chats) != 2 {
			t.Fatalf("expected 2 chats, got %d", len(chats))
		}
	})

	t.Run("vector memory embeddings survive chat rewrites", func(t *testing.T) {
		chat := NewChat("vector-chat")
		chat.Messages = append(chat.Messages, NewMessage("user", "remember the gold account policy", nil))
		if err := s.SetChat(*chat); err != nil {
			t.Fatalf("failed to save vector chat: %v", err)
		}
		otherChat := NewChat("vector-other-chat")
		otherChat.Title = "Physics Notes"
		otherChat.Messages = append(otherChat.Messages, NewMessage("user", "plasma is the medium for magnetohydrodynamics", nil))
		if err := s.SetChat(*otherChat); err != nil {
			t.Fatalf("failed to save other vector chat: %v", err)
		}

		items, err := s.VectorMemoryItems("vector-chat")
		if err != nil {
			t.Fatalf("failed to load vector memory items: %v", err)
		}
		if len(items) != 1 {
			t.Fatalf("expected one vector memory item, got %d", len(items))
		}
		if items[0].ChatID != "vector-chat" {
			t.Fatalf("expected vector item chat ID, got %q", items[0].ChatID)
		}

		if err := s.UpsertMessageEmbedding("vector-chat", "nomic-embed-text", "hash-1", []float32{0.25, 0.5, 0.75}); err != nil {
			t.Fatalf("failed to save vector embedding: %v", err)
		}
		if err := s.UpsertMessageEmbedding("vector-other-chat", "nomic-embed-text", "hash-2", []float32{0.1, 0.2, 0.3}); err != nil {
			t.Fatalf("failed to save other vector embedding: %v", err)
		}

		chat.Title = "Vector Chat"
		chat.Messages = append(chat.Messages, NewMessage("assistant", "noted", nil))
		if err := s.SetChat(*chat); err != nil {
			t.Fatalf("failed to rewrite vector chat: %v", err)
		}

		embeddings, err := s.VectorMemoryEmbeddings("vector-chat", "nomic-embed-text")
		if err != nil {
			t.Fatalf("failed to load vector memory embeddings: %v", err)
		}
		if len(embeddings) != 1 || embeddings[0].ContentHash != "hash-1" {
			t.Fatalf("unexpected embeddings: %#v", embeddings)
		}
		if got := embeddings[0].Embedding; len(got) != 3 || got[0] != 0.25 || got[2] != 0.75 {
			t.Fatalf("unexpected embedding vector: %#v", got)
		}
		allItems, err := s.VectorMemoryItemsAllChats()
		if err != nil {
			t.Fatalf("failed to load all vector memory items: %v", err)
		}
		if !containsVectorMemoryItem(allItems, "vector-other-chat", "Physics Notes") {
			t.Fatalf("expected all vector memory items to include source chat metadata: %#v", allItems)
		}
		allEmbeddings, err := s.VectorMemoryEmbeddingsAllChats("nomic-embed-text")
		if err != nil {
			t.Fatalf("failed to load all vector memory embeddings: %v", err)
		}
		if !containsVectorMemoryEmbedding(allEmbeddings, "vector-chat", "hash-1") ||
			!containsVectorMemoryEmbedding(allEmbeddings, "vector-other-chat", "hash-2") {
			t.Fatalf("expected all vector memory embeddings to include chat IDs: %#v", allEmbeddings)
		}
		selectedItems, err := s.VectorMemoryItemsForChats([]string{"vector-other-chat"})
		if err != nil {
			t.Fatalf("failed to load selected vector memory items: %v", err)
		}
		if !containsVectorMemoryItem(selectedItems, "vector-other-chat", "Physics Notes") ||
			containsVectorMemoryItem(selectedItems, "vector-chat", "Vector Chat") {
			t.Fatalf("expected selected vector memory items to stay scoped: %#v", selectedItems)
		}
		selectedEmbeddings, err := s.VectorMemoryEmbeddingsForChats("nomic-embed-text", []string{"vector-other-chat"})
		if err != nil {
			t.Fatalf("failed to load selected vector memory embeddings: %v", err)
		}
		if !containsVectorMemoryEmbedding(selectedEmbeddings, "vector-other-chat", "hash-2") ||
			containsVectorMemoryEmbedding(selectedEmbeddings, "vector-chat", "hash-1") {
			t.Fatalf("expected selected vector memory embeddings to stay scoped: %#v", selectedEmbeddings)
		}
		if err := s.DeleteChat("vector-chat"); err != nil {
			t.Fatalf("failed to delete vector chat: %v", err)
		}
		if err := s.DeleteChat("vector-other-chat"); err != nil {
			t.Fatalf("failed to delete other vector chat: %v", err)
		}
	})

	t.Run("delete chat", func(t *testing.T) {
		if err := s.DeleteChat("test-chat-1"); err != nil {
			t.Fatalf("failed to delete chat: %v", err)
		}

		// Verify it's gone
		_, err := s.Chat("test-chat-1")
		if err == nil {
			t.Error("expected error retrieving deleted chat")
		}

		// Verify other chat still exists
		chats, err := s.Chats()
		if err != nil {
			t.Fatalf("failed to list chats: %v", err)
		}
		if len(chats) != 1 {
			t.Fatalf("expected 1 chat after deletion, got %d", len(chats))
		}
	})
}

// setupTestStore creates a temporary store for testing
func setupTestStore(t *testing.T) (*Store, func()) {
	t.Helper()
	t.Setenv("OLLAMA_APP_DATA_KEY", "")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")

	tmpDir := t.TempDir()

	// Override legacy config path to ensure no migration happens
	oldLegacyConfigPath := legacyConfigPath
	legacyConfigPath = filepath.Join(tmpDir, "config.json")

	s := &Store{DBPath: filepath.Join(tmpDir, "db.sqlite")}

	cleanup := func() {
		s.Close()
		legacyConfigPath = oldLegacyConfigPath
	}

	return s, cleanup
}

func containsVectorMemoryItem(items []VectorMemoryItem, chatID, chatTitle string) bool {
	for _, item := range items {
		if item.ChatID == chatID && item.ChatTitle == chatTitle {
			return true
		}
	}
	return false
}

func containsVectorMemoryEmbedding(embeddings []VectorMemoryEmbedding, chatID, contentHash string) bool {
	for _, embedding := range embeddings {
		if embedding.ChatID == chatID && embedding.ContentHash == contentHash {
			return true
		}
	}
	return false
}
