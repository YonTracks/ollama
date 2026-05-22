//go:build windows || darwin

package store

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDatabaseEncryptsSensitiveAppDataWhenKeyIsSet(t *testing.T) {
	t.Setenv("OLLAMA_APP_DATA_KEY", "correct horse battery staple")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")

	db, err := newDatabase(filepath.Join(t.TempDir(), "store.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	searched := true
	messageToolResult := json.RawMessage(`{"secret":"message-tool-result"}`)
	chat := NewChat("encrypted-chat")
	chat.Title = "Secret chat title"
	chat.BrowserState = json.RawMessage(`{"url":"https://secret.example.test"}`)
	chat.Messages = append(chat.Messages, NewMessage("user", "secret prompt content", &MessageOptions{
		Thinking: "secret thinking content",
		Attachments: []File{{
			Filename: "secret-file.txt",
			Data:     []byte("secret attachment data"),
		}},
		ToolCalls: []ToolCall{{
			Type: "function",
			Function: ToolFunction{
				Name:      "lookup",
				Arguments: `{"query":"secret tool arguments"}`,
				Result: map[string]any{
					"answer": "secret tool result",
				},
			},
		}},
		ToolResult: &messageToolResult,
		Stats: &ResponseStats{
			DoneReason: "secret-done-reason",
		},
		ContextNotice: &ContextNotice{
			Mode:    "friendly",
			Action:  "summarize",
			Summary: "secret context summary",
		},
		ContextWarnings: []ContextWarning{{
			Kind:    "secret-warning-kind",
			Message: "secret warning message",
		}},
		WebSearchMode:     "manual",
		WebSearchProvider: "custom",
		WebSearchResults: []MessageSearchResult{{
			Title:   "secret result title",
			URL:     "https://example.test/result",
			Content: "secret result snippet",
		}},
		WebSearchSearched: &searched,
	}))

	if err := db.saveChat(*chat); err != nil {
		t.Fatal(err)
	}

	var rawTitle, rawBrowserState string
	if err := db.conn.QueryRow(`SELECT title, browser_state FROM chats WHERE id = ?`, chat.ID).Scan(&rawTitle, &rawBrowserState); err != nil {
		t.Fatal(err)
	}
	assertEncryptedString(t, rawTitle, "Secret chat title")
	assertEncryptedString(t, rawBrowserState, "secret.example")

	var rawContent, rawThinking, rawToolResult, rawStats, rawContextNotice, rawContextWarnings, rawSearchMetadata string
	if err := db.conn.QueryRow(`
		SELECT content, thinking, tool_result, stats, context_notice, context_warnings, web_search_metadata
		FROM messages
		WHERE chat_id = ?
	`, chat.ID).Scan(
		&rawContent,
		&rawThinking,
		&rawToolResult,
		&rawStats,
		&rawContextNotice,
		&rawContextWarnings,
		&rawSearchMetadata,
	); err != nil {
		t.Fatal(err)
	}
	assertEncryptedString(t, rawContent, "secret prompt")
	assertEncryptedString(t, rawThinking, "secret thinking")
	assertEncryptedString(t, rawToolResult, "message-tool-result")
	assertEncryptedString(t, rawStats, "secret-done")
	assertEncryptedString(t, rawContextNotice, "secret context")
	assertEncryptedString(t, rawContextWarnings, "secret warning")
	assertEncryptedString(t, rawSearchMetadata, "secret result")

	var rawFilename string
	var rawAttachmentData []byte
	if err := db.conn.QueryRow(`SELECT filename, data FROM attachments`).Scan(&rawFilename, &rawAttachmentData); err != nil {
		t.Fatal(err)
	}
	assertEncryptedString(t, rawFilename, "secret-file")
	assertEncryptedBlob(t, rawAttachmentData, []byte("secret attachment data"))

	var rawFunctionArgs, rawFunctionResult string
	if err := db.conn.QueryRow(`SELECT function_arguments, function_result FROM tool_calls`).Scan(&rawFunctionArgs, &rawFunctionResult); err != nil {
		t.Fatal(err)
	}
	assertEncryptedString(t, rawFunctionArgs, "secret tool arguments")
	assertEncryptedString(t, rawFunctionResult, "secret tool result")

	retrieved, err := db.getChatWithOptions(chat.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if retrieved.Title != chat.Title {
		t.Fatalf("expected decrypted title %q, got %q", chat.Title, retrieved.Title)
	}
	if string(retrieved.BrowserState) != string(chat.BrowserState) {
		t.Fatalf("expected decrypted browser state %s, got %s", chat.BrowserState, retrieved.BrowserState)
	}
	if got := retrieved.Messages[0].Content; got != "secret prompt content" {
		t.Fatalf("expected decrypted content, got %q", got)
	}
	if got := retrieved.Messages[0].Attachments[0].Filename; got != "secret-file.txt" {
		t.Fatalf("expected decrypted attachment filename, got %q", got)
	}
	if got := retrieved.Messages[0].Attachments[0].Data; !bytes.Equal(got, []byte("secret attachment data")) {
		t.Fatalf("expected decrypted attachment data, got %q", got)
	}
	if got := retrieved.Messages[0].ToolCalls[0].Function.Arguments; got != `{"query":"secret tool arguments"}` {
		t.Fatalf("expected decrypted tool arguments, got %q", got)
	}
	if retrieved.Messages[0].Stats == nil || retrieved.Messages[0].Stats.DoneReason != "secret-done-reason" {
		t.Fatalf("expected decrypted stats, got %#v", retrieved.Messages[0].Stats)
	}
	if retrieved.Messages[0].ContextNotice == nil || retrieved.Messages[0].ContextNotice.Summary != "secret context summary" {
		t.Fatalf("expected decrypted context notice, got %#v", retrieved.Messages[0].ContextNotice)
	}
	if len(retrieved.Messages[0].WebSearchResults) != 1 || retrieved.Messages[0].WebSearchResults[0].Content != "secret result snippet" {
		t.Fatalf("expected decrypted search metadata, got %#v", retrieved.Messages[0].WebSearchResults)
	}

	items, err := db.getVectorMemoryItems(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ChatTitle != chat.Title || items[0].Message.Content != "secret prompt content" {
		t.Fatalf("expected decrypted vector memory items, got %#v", items)
	}

	chats, err := db.getAllChats()
	if err != nil {
		t.Fatal(err)
	}
	if len(chats) != 1 || chats[0].Title != chat.Title || len(chats[0].Messages) != 1 || chats[0].Messages[0].Content != "secret prompt content" {
		t.Fatalf("expected decrypted chat list, got %#v", chats)
	}

	user := User{Name: "Secret User", Email: "secret@example.test", Plan: "secret-plan"}
	if err := db.setUser(user); err != nil {
		t.Fatal(err)
	}
	var rawName, rawEmail, rawPlan string
	if err := db.conn.QueryRow(`SELECT name, email, plan FROM users`).Scan(&rawName, &rawEmail, &rawPlan); err != nil {
		t.Fatal(err)
	}
	assertEncryptedString(t, rawName, "Secret User")
	assertEncryptedString(t, rawEmail, "secret@example")
	assertEncryptedString(t, rawPlan, "secret-plan")
	retrievedUser, err := db.getUser()
	if err != nil {
		t.Fatal(err)
	}
	if retrievedUser == nil || retrievedUser.Name != user.Name || retrievedUser.Email != user.Email || retrievedUser.Plan != user.Plan {
		t.Fatalf("expected decrypted user, got %#v", retrievedUser)
	}
}

func TestDatabaseEncryptionReadsExistingPlaintextRows(t *testing.T) {
	t.Setenv("OLLAMA_APP_DATA_KEY", "correct horse battery staple")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")

	db, err := newDatabase(filepath.Join(t.TempDir(), "store.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if _, err := db.conn.Exec(`INSERT INTO chats (id, title, created_at, browser_state) VALUES (?, ?, CURRENT_TIMESTAMP, ?)`, "plain-chat", "Plain title", `{"url":"https://plain.example.test"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.conn.Exec(`INSERT INTO messages (chat_id, role, content, thinking) VALUES (?, ?, ?, ?)`, "plain-chat", "user", "plain content", "plain thinking"); err != nil {
		t.Fatal(err)
	}

	chat, err := db.getChatWithOptions("plain-chat", true)
	if err != nil {
		t.Fatal(err)
	}
	if chat.Title != "Plain title" || string(chat.BrowserState) != `{"url":"https://plain.example.test"}` {
		t.Fatalf("expected plaintext compatibility, got %#v", chat)
	}
	if len(chat.Messages) != 1 || chat.Messages[0].Content != "plain content" || chat.Messages[0].Thinking != "plain thinking" {
		t.Fatalf("expected plaintext message compatibility, got %#v", chat.Messages)
	}
}

func TestDatabaseEncryptionEncryptsExistingPlaintextRowsWhenEnabled(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "store.db")
	t.Setenv("OLLAMA_APP_DATA_KEY", "")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")

	db, err := newDatabase(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	chat := NewChat("plain-before-key")
	chat.Title = "Plain before key title"
	chat.Messages = append(chat.Messages, NewMessage("user", "plain before key content", nil))
	if err := db.saveChat(*chat); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("OLLAMA_APP_DATA_KEY", "correct horse battery staple")
	db, err = newDatabase(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	var rawTitle, rawContent string
	if err := db.conn.QueryRow(`SELECT title FROM chats WHERE id = ?`, chat.ID).Scan(&rawTitle); err != nil {
		t.Fatal(err)
	}
	if err := db.conn.QueryRow(`SELECT content FROM messages WHERE chat_id = ?`, chat.ID).Scan(&rawContent); err != nil {
		t.Fatal(err)
	}
	assertEncryptedString(t, rawTitle, "Plain before key title")
	assertEncryptedString(t, rawContent, "plain before key content")

	retrieved, err := db.getChatWithOptions(chat.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if retrieved.Title != "Plain before key title" || retrieved.Messages[0].Content != "plain before key content" {
		t.Fatalf("expected encrypted existing rows to stay readable, got %#v", retrieved)
	}
}

func TestDatabaseEncryptionCanBeDisabled(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "store.db")
	t.Setenv("OLLAMA_APP_DATA_KEY", "correct horse battery staple")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")

	db, err := newDatabase(dbPath)
	if err != nil {
		t.Fatal(err)
	}

	chat := NewChat("toggle-chat")
	chat.Title = "Toggle secret title"
	chat.Messages = append(chat.Messages, NewMessage("user", "toggle secret content", &MessageOptions{
		Attachments: []File{{
			Filename: "toggle-secret.txt",
			Data:     []byte("toggle secret attachment"),
		}},
	}))
	if err := db.saveChat(*chat); err != nil {
		t.Fatal(err)
	}

	var rawTitle string
	if err := db.conn.QueryRow(`SELECT title FROM chats WHERE id = ?`, chat.ID).Scan(&rawTitle); err != nil {
		t.Fatal(err)
	}
	assertEncryptedString(t, rawTitle, "Toggle secret title")
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "off")
	db, err = newDatabase(dbPath)
	if err != nil {
		t.Fatal(err)
	}

	var rawContent string
	var rawAttachmentData []byte
	if err := db.conn.QueryRow(`SELECT title FROM chats WHERE id = ?`, chat.ID).Scan(&rawTitle); err != nil {
		t.Fatal(err)
	}
	if err := db.conn.QueryRow(`SELECT content FROM messages WHERE chat_id = ?`, chat.ID).Scan(&rawContent); err != nil {
		t.Fatal(err)
	}
	if err := db.conn.QueryRow(`SELECT data FROM attachments`).Scan(&rawAttachmentData); err != nil {
		t.Fatal(err)
	}
	assertPlainString(t, rawTitle, "Toggle secret title")
	assertPlainString(t, rawContent, "toggle secret content")
	assertPlainBlob(t, rawAttachmentData, []byte("toggle secret attachment"))

	plainChat := NewChat("plain-after-off")
	plainChat.Title = "Plain after off"
	plainChat.Messages = append(plainChat.Messages, NewMessage("user", "plain after off content", nil))
	if err := db.saveChat(*plainChat); err != nil {
		t.Fatal(err)
	}
	var rawPlainContent string
	if err := db.conn.QueryRow(`SELECT content FROM messages WHERE chat_id = ?`, plainChat.ID).Scan(&rawPlainContent); err != nil {
		t.Fatal(err)
	}
	assertPlainString(t, rawPlainContent, "plain after off content")
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("OLLAMA_APP_DATA_KEY", "")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")
	db, err = newDatabase(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	retrieved, err := db.getChatWithOptions(chat.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if retrieved.Title != "Toggle secret title" || retrieved.Messages[0].Content != "toggle secret content" {
		t.Fatalf("expected decrypted rows to remain readable without key, got %#v", retrieved)
	}
}

func TestDatabaseEncryptionMarkerRequiresKeyAfterEncryptionIsEnabled(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "store.db")
	t.Setenv("OLLAMA_APP_DATA_KEY", "correct horse battery staple")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")

	db, err := newDatabase(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("OLLAMA_APP_DATA_KEY", "")
	db, err = newDatabase(dbPath)
	if err == nil {
		_ = db.Close()
		t.Fatal("expected database with app data encryption marker to require OLLAMA_APP_DATA_KEY")
	}
	if !strings.Contains(err.Error(), "OLLAMA_APP_DATA_KEY") {
		t.Fatalf("expected OLLAMA_APP_DATA_KEY error, got %v", err)
	}

	t.Setenv("OLLAMA_APP_DATA_KEY", "wrong key")
	db, err = newDatabase(dbPath)
	if err == nil {
		_ = db.Close()
		t.Fatal("expected wrong OLLAMA_APP_DATA_KEY to fail")
	}
	if !errors.Is(err, ErrAppDataEncryptionKeyInvalid) {
		t.Fatalf("expected invalid key error, got %v", err)
	}
}

func TestStoreAppDataEncryptionStatusReportsMissingAndWrongKey(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "store.db")
	t.Setenv("OLLAMA_APP_DATA_KEY", "correct horse battery staple")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")

	db, err := newDatabase(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("OLLAMA_APP_DATA_KEY", "")
	status := (&Store{DBPath: dbPath}).AppDataEncryptionStatus()
	if !status.Encrypted || status.State != AppDataEncryptionStateKeyMissing {
		t.Fatalf("expected missing key encrypted status, got %#v", status)
	}
	if status.Error == "" {
		t.Fatalf("expected user-facing encryption error, got %#v", status)
	}

	t.Setenv("OLLAMA_APP_DATA_KEY", "wrong key")
	status = (&Store{DBPath: dbPath}).AppDataEncryptionStatus()
	if !status.Encrypted || status.State != AppDataEncryptionStateKeyInvalid {
		t.Fatalf("expected invalid key encrypted status, got %#v", status)
	}

	t.Setenv("OLLAMA_APP_DATA_KEY", "correct horse battery staple")
	status = (&Store{DBPath: dbPath}).AppDataEncryptionStatus()
	if !status.Encrypted || status.State != AppDataEncryptionStateEncrypted || status.Error != "" {
		t.Fatalf("expected healthy encrypted status, got %#v", status)
	}
}

func TestDatabaseEncryptionUsesPerDatabaseSalt(t *testing.T) {
	t.Setenv("OLLAMA_APP_DATA_KEY", "correct horse battery staple")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")

	firstDB, err := newDatabase(filepath.Join(t.TempDir(), "first.db"))
	if err != nil {
		t.Fatal(err)
	}
	firstSalt := readRawAppDataSalt(t, firstDB)
	if err := firstDB.Close(); err != nil {
		t.Fatal(err)
	}

	secondDB, err := newDatabase(filepath.Join(t.TempDir(), "second.db"))
	if err != nil {
		t.Fatal(err)
	}
	secondSalt := readRawAppDataSalt(t, secondDB)
	if err := secondDB.Close(); err != nil {
		t.Fatal(err)
	}

	if firstSalt == "" || secondSalt == "" {
		t.Fatalf("expected per-database salts, got first=%q second=%q", firstSalt, secondSalt)
	}
	if firstSalt == secondSalt {
		t.Fatalf("expected unique per-database salts, both were %q", firstSalt)
	}
	if firstSalt == legacyAppDataKeySalt || secondSalt == legacyAppDataKeySalt {
		t.Fatalf("expected stored salts to differ from legacy fixed salt")
	}
}

func TestDatabaseEncryptionMigratesLegacyFixedSalt(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "store.db")
	passphrase := "correct horse battery staple"
	t.Setenv("OLLAMA_APP_DATA_KEY", "")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")

	db, err := newDatabase(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	db.cipher, err = newDataCipher(passphrase, []byte(legacyAppDataKeySalt))
	if err != nil {
		t.Fatal(err)
	}
	db.encryptAppData = true
	if err := db.setAppDataEncryptionMarker(); err != nil {
		t.Fatal(err)
	}
	chat := NewChat("legacy-chat")
	chat.Title = "Legacy secret title"
	chat.Messages = append(chat.Messages, NewMessage("user", "legacy secret content", nil))
	if err := db.saveChat(*chat); err != nil {
		t.Fatal(err)
	}
	if got := readRawAppDataSalt(t, db); got != "" {
		t.Fatalf("expected legacy DB to have no per-database salt, got %q", got)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("OLLAMA_APP_DATA_KEY", "wrong key")
	status := (&Store{DBPath: dbPath}).AppDataEncryptionStatus()
	if !status.Encrypted || !status.Legacy || status.State != AppDataEncryptionStateKeyInvalid {
		t.Fatalf("expected locked legacy status, got %#v", status)
	}

	t.Setenv("OLLAMA_APP_DATA_KEY", passphrase)
	db, err = newDatabase(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if got := readRawAppDataSalt(t, db); got == "" {
		t.Fatal("expected legacy DB to be migrated to a per-database salt")
	}
	status = (&Store{DBPath: dbPath, db: db}).AppDataEncryptionStatus()
	if status.Legacy || status.State != AppDataEncryptionStateEncrypted {
		t.Fatalf("expected migrated encrypted status, got %#v", status)
	}
	retrieved, err := db.getChatWithOptions(chat.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if retrieved.Title != chat.Title || retrieved.Messages[0].Content != "legacy secret content" {
		t.Fatalf("expected migrated chat to remain readable, got %#v", retrieved)
	}
}

func TestDatabaseEncryptionDisableRequiresKeyForEncryptedRows(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "store.db")
	t.Setenv("OLLAMA_APP_DATA_KEY", "correct horse battery staple")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")

	db, err := newDatabase(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	chat := NewChat("requires-key-chat")
	chat.Title = "Requires key title"
	chat.Messages = append(chat.Messages, NewMessage("user", "requires key content", nil))
	if err := db.saveChat(*chat); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("OLLAMA_APP_DATA_KEY", "")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "off")
	db, err = newDatabase(dbPath)
	if err == nil {
		_ = db.Close()
		t.Fatal("expected encrypted rows to require OLLAMA_APP_DATA_KEY before decrypting")
	}
	if !strings.Contains(err.Error(), "OLLAMA_APP_DATA_KEY") {
		t.Fatalf("expected OLLAMA_APP_DATA_KEY error, got %v", err)
	}
}

func TestStoreResetAppDataBacksUpLockedDatabase(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "store.db")
	t.Setenv("OLLAMA_APP_DATA_KEY", "correct horse battery staple")
	t.Setenv("OLLAMA_APP_DATA_ENCRYPTION", "")

	initialStore := &Store{DBPath: dbPath}
	chat := NewChat("locked-reset-chat")
	chat.Title = "Locked reset title"
	chat.Messages = append(chat.Messages, NewMessage("user", "locked reset content", nil))
	if err := initialStore.SetChat(*chat); err != nil {
		t.Fatal(err)
	}
	if err := initialStore.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("OLLAMA_APP_DATA_KEY", "")
	lockedStore := &Store{DBPath: dbPath}
	if _, err := lockedStore.Settings(); err == nil {
		t.Fatal("expected encrypted database to be locked without key")
	}

	result, err := lockedStore.ResetAppData()
	if err != nil {
		t.Fatal(err)
	}
	if len(result.BackupPaths) == 0 {
		t.Fatalf("expected reset to preserve a backup, got %#v", result)
	}
	if _, err := os.Stat(result.BackupPaths[0]); err != nil {
		t.Fatalf("expected backup file to exist: %v", err)
	}
	settings, err := lockedStore.Settings()
	if err != nil {
		t.Fatalf("expected fresh database after reset: %v", err)
	}
	if settings.LastHomeView != "launch" {
		t.Fatalf("expected fresh settings after reset, got %#v", settings)
	}
	chats, err := lockedStore.Chats()
	if err != nil {
		t.Fatal(err)
	}
	if len(chats) != 0 {
		t.Fatalf("expected fresh database to have no chats, got %#v", chats)
	}
	if err := lockedStore.Close(); err != nil {
		t.Fatal(err)
	}
}

func assertEncryptedString(t *testing.T, value string, secret string) {
	t.Helper()
	if !strings.HasPrefix(value, encryptedTextPrefix) {
		t.Fatalf("expected encrypted value with prefix %q, got %q", encryptedTextPrefix, value)
	}
	if strings.Contains(value, secret) {
		t.Fatalf("encrypted value contains plaintext secret %q: %q", secret, value)
	}
}

func readRawAppDataSalt(t *testing.T, db *database) string {
	t.Helper()
	var salt string
	err := db.conn.QueryRow(`SELECT value FROM app_metadata WHERE key = ?`, appDataEncryptionSaltKey).Scan(&salt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ""
		}
		t.Fatal(err)
	}
	return salt
}

func assertEncryptedBlob(t *testing.T, value []byte, secret []byte) {
	t.Helper()
	if !bytes.HasPrefix(value, encryptedBlobPrefix) {
		t.Fatalf("expected encrypted blob prefix %q, got %q", encryptedBlobPrefix, value)
	}
	if bytes.Contains(value, secret) {
		t.Fatalf("encrypted blob contains plaintext secret %q", secret)
	}
}

func assertPlainString(t *testing.T, value string, secret string) {
	t.Helper()
	if strings.HasPrefix(value, encryptedTextPrefix) {
		t.Fatalf("expected plaintext value, got encrypted %q", value)
	}
	if !strings.Contains(value, secret) {
		t.Fatalf("plaintext value does not contain expected secret %q: %q", secret, value)
	}
}

func assertPlainBlob(t *testing.T, value []byte, secret []byte) {
	t.Helper()
	if bytes.HasPrefix(value, encryptedBlobPrefix) {
		t.Fatalf("expected plaintext blob, got encrypted %q", value)
	}
	if !bytes.Contains(value, secret) {
		t.Fatalf("plaintext blob does not contain expected secret %q", secret)
	}
}
