//go:build windows || darwin

package ui

import (
	"strings"
	"testing"

	"github.com/ollama/ollama/app/store"
	"github.com/ollama/ollama/app/ui/responses"
)

func TestPrepareContextChatSummarizesOldMessages(t *testing.T) {
	numCtx := 260
	chat := &store.Chat{
		ID: "chat",
		Messages: []store.Message{
			store.NewMessage("system", "Always answer carefully.", nil),
			store.NewMessage("user", "old user topic "+strings.Repeat("alpha ", 120), nil),
			store.NewMessage("assistant", "old assistant answer "+strings.Repeat("beta ", 120), nil),
			store.NewMessage("user", "latest question", nil),
		},
	}

	prepared, notice := prepareContextChat(chat, contextRequestSettings{
		Mode:                     "friendly",
		NumCtx:                   &numCtx,
		ReserveOutputTokens:      40,
		NearFullThresholdPercent: 85,
		EnableAutoTrim:           true,
		EnableAutoSummarize:      true,
	})

	if notice.Action != "summarized" {
		t.Fatalf("expected summarized action, got %q", notice.Action)
	}
	if estimateStoreMessagesTokens(prepared.Messages) > 220 {
		t.Fatalf("prepared messages exceeded prompt budget")
	}

	var summary string
	for _, message := range prepared.Messages {
		if message.Role == "system" && strings.HasPrefix(message.Content, "Summary of earlier omitted conversation:") {
			summary = message.Content
			break
		}
	}
	if summary == "" {
		t.Fatalf("expected summary system message")
	}
	if !strings.Contains(summary, "old user topic") || !strings.Contains(summary, "old assistant answer") {
		t.Fatalf("summary did not include omitted message excerpts: %q", summary)
	}
	if !containsStoreMessage(prepared.Messages, chat.Messages[0]) || !containsStoreMessage(prepared.Messages, chat.Messages[3]) {
		t.Fatalf("expected system and latest user messages to be retained")
	}
	if containsStoreMessage(prepared.Messages, chat.Messages[1]) {
		t.Fatalf("expected oldest user message to be omitted")
	}
}

func TestPrepareContextChatRetrievesRelevantMemory(t *testing.T) {
	chat := &store.Chat{
		ID: "chat",
		Messages: []store.Message{
			store.NewMessage("system", "Always answer carefully.", nil),
			store.NewMessage("user", "The customer escalation policy says gold accounts need same-day review.", nil),
			store.NewMessage("assistant", "Gold account escalations should be reviewed before end of day.", nil),
			store.NewMessage("user", "We also discussed dashboard colors.", nil),
			store.NewMessage("assistant", "The dashboard should use restrained colors.", nil),
			store.NewMessage("user", "What should I do for a gold account escalation?", nil),
		},
	}

	prepared, notice := prepareContextChat(chat, contextRequestSettings{
		Mode:                     "friendly",
		ReserveOutputTokens:      40,
		NearFullThresholdPercent: 85,
		EnableAutoTrim:           true,
		EnableRetrieval:          true,
		RetrievalLimit:           2,
	})

	if notice.RetrievedMemoryCount == nil || *notice.RetrievedMemoryCount == 0 {
		t.Fatalf("expected retrieved memory count")
	}

	var memory string
	for _, message := range prepared.Messages {
		if message.Role == "system" && strings.HasPrefix(message.Content, "Relevant retrieved conversation memory:") {
			memory = message.Content
			break
		}
	}
	if memory == "" {
		t.Fatalf("expected retrieval memory system message")
	}
	if !strings.Contains(memory, "gold accounts") {
		t.Fatalf("retrieval memory did not include relevant policy: %q", memory)
	}
	if strings.Contains(memory, "dashboard colors") {
		t.Fatalf("retrieval memory included unrelated color discussion: %q", memory)
	}

	warnings := contextWarnings(nil, notice, contextRequestSettings{NearFullThresholdPercent: 85})
	if !containsContextWarning(warnings, "retrieved") {
		t.Fatalf("expected retrieved context warning, got %#v", warnings)
	}
}

func TestPrepareContextChatUsesInjectedRetriever(t *testing.T) {
	chat := &store.Chat{
		ID: "chat",
		Messages: []store.Message{
			store.NewMessage("user", "Remember the vector-only policy.", nil),
			store.NewMessage("assistant", "Stored.", nil),
			store.NewMessage("user", "What policy did we discuss?", nil),
		},
	}

	prepared, notice := prepareContextChatWithRetriever(
		chat,
		contextRequestSettings{
			Mode:                     "friendly",
			ReserveOutputTokens:      40,
			NearFullThresholdPercent: 85,
			EnableRetrieval:          true,
			RetrievalLimit:           1,
		},
		func(messages []store.Message, limit int) []store.Message {
			if limit != 1 {
				t.Fatalf("retrieval limit = %d, want 1", limit)
			}
			return []store.Message{messages[0]}
		},
	)

	if notice.RetrievedMemoryCount == nil || *notice.RetrievedMemoryCount != 1 {
		t.Fatalf("expected one retrieved memory, got %#v", notice.RetrievedMemoryCount)
	}
	var memory string
	for _, message := range prepared.Messages {
		if message.Role == "system" && strings.HasPrefix(message.Content, "Relevant retrieved conversation memory:") {
			memory = message.Content
			break
		}
	}
	if !strings.Contains(memory, "vector-only policy") {
		t.Fatalf("expected injected retrieval memory, got %q", memory)
	}
}

func TestPrepareContextChatBoostsRememberedName(t *testing.T) {
	chat := &store.Chat{
		ID: "chat",
		Messages: []store.Message{
			store.NewMessage("user", "We talked about dashboard colors.", nil),
			store.NewMessage("assistant", "The dashboard should stay restrained.", nil),
			store.NewMessage("user", "My name is Joe Citizen.", nil),
			store.NewMessage("assistant", "Nice to meet you, Joe Citizen.", nil),
			store.NewMessage("user", "What is my name and what is in app/tools?", nil),
		},
	}

	prepared, notice := prepareContextChat(chat, contextRequestSettings{
		Mode:                     "friendly",
		ReserveOutputTokens:      40,
		NearFullThresholdPercent: 85,
		EnableRetrieval:          true,
		RetrievalLimit:           1,
	})

	if notice.RetrievedMemoryCount == nil || *notice.RetrievedMemoryCount != 1 {
		t.Fatalf("expected one retrieved memory, got %#v", notice.RetrievedMemoryCount)
	}

	var memory string
	for _, message := range prepared.Messages {
		if message.Role == "system" && strings.HasPrefix(message.Content, "Relevant retrieved conversation memory:") {
			memory = message.Content
			break
		}
	}
	if !strings.Contains(memory, "My name is Joe Citizen") {
		t.Fatalf("expected name memory to be retrieved, got %q", memory)
	}
	if !strings.Contains(memory, "answer from this memory") {
		t.Fatalf("expected retrieval guidance, got %q", memory)
	}
}

func TestContextSettingsNormalizeRetrievalScope(t *testing.T) {
	allChats := "all"
	settings := contextSettingsFromRequest(responses.ChatRequest{
		RetrievalScope: allChats,
	})
	if settings.RetrievalScope != retrievalScopeAllChats {
		t.Fatalf("expected all-chat retrieval scope, got %q", settings.RetrievalScope)
	}

	settings = contextSettingsFromRequest(responses.ChatRequest{
		RetrievalScope:   retrievalScopeSelected,
		RetrievalChatIDs: []string{" chat-a ", "chat-a", "", "chat-b"},
	})
	if settings.RetrievalScope != retrievalScopeSelected {
		t.Fatalf("expected selected-chat retrieval scope, got %q", settings.RetrievalScope)
	}
	if got := strings.Join(settings.RetrievalChatIDs, ","); got != "chat-a,chat-b" {
		t.Fatalf("expected cleaned retrieval chat IDs, got %q", got)
	}

	settings = contextSettingsFromRequest(responses.ChatRequest{
		RetrievalScope: "unexpected",
	})
	if settings.RetrievalScope != retrievalScopeCurrentChat {
		t.Fatalf("expected current-chat retrieval scope fallback, got %q", settings.RetrievalScope)
	}
}

func TestCrossChatVectorMemoryLabelsSources(t *testing.T) {
	item := store.VectorMemoryItem{
		ChatID:    "source-chat",
		ChatTitle: "Physics Notes",
		Message:   store.NewMessage("user", "Plasma is the medium.", nil),
	}

	message := vectorRetrievedMessage(item, "current-chat", retrievalScopeAllChats)
	if !strings.Contains(message.Content, `[From "Physics Notes"]`) {
		t.Fatalf("expected cross-chat source label, got %q", message.Content)
	}

	currentMessage := vectorRetrievedMessage(item, "source-chat", retrievalScopeAllChats)
	if strings.Contains(currentMessage.Content, "[From") {
		t.Fatalf("did not expect current chat source label, got %q", currentMessage.Content)
	}

	selectedMessage := vectorRetrievedMessage(item, "current-chat", retrievalScopeSelected)
	if !strings.Contains(selectedMessage.Content, `[From "Physics Notes"]`) {
		t.Fatalf("expected selected cross-chat source label, got %q", selectedMessage.Content)
	}
}

func TestCrossChatVectorCandidatesAllowFirstMessageQueries(t *testing.T) {
	query := store.VectorMemoryItem{
		ChatID:    "current-chat",
		MessageID: 1,
		Message:   store.NewMessage("user", "What do we know about plasma?", nil),
	}
	items := []store.VectorMemoryItem{
		query,
		{
			ChatID:    "source-chat",
			MessageID: 1,
			Message:   store.NewMessage("user", "Plasma notes", nil),
		},
	}

	candidates := vectorMemoryCandidateItems(items, query, retrievalScopeAllChats)
	if len(candidates) != 1 || candidates[0].ChatID != "source-chat" {
		t.Fatalf("expected cross-chat candidate for first message query, got %#v", candidates)
	}

	candidates = vectorMemoryCandidateItems(items, query, retrievalScopeSelected)
	if len(candidates) != 1 || candidates[0].ChatID != "source-chat" {
		t.Fatalf("expected selected cross-chat candidate for first message query, got %#v", candidates)
	}

	selectedIDs := selectedRetrievalChatIDs("current-chat", []string{"source-chat", "current-chat"})
	if got := strings.Join(selectedIDs, ","); got != "current-chat,source-chat" {
		t.Fatalf("expected current chat plus selected IDs, got %q", got)
	}
}

func TestPrepareContextChatAddsExpertInstructions(t *testing.T) {
	chat := &store.Chat{
		ID: "chat",
		Messages: []store.Message{
			store.NewMessage("user", "Diagnose this build failure.", nil),
		},
	}

	prepared, notice := prepareContextChat(chat, contextRequestSettings{
		Mode:                     "friendly",
		ReserveOutputTokens:      40,
		NearFullThresholdPercent: 85,
		ExpertMode:               true,
		ExpertInstructions:       "Answer like a senior release engineer.",
	})

	if !notice.ExpertMode {
		t.Fatalf("expected expert mode notice")
	}
	if len(prepared.Messages) < 2 || prepared.Messages[0].Role != "system" {
		t.Fatalf("expected expert system message before user message")
	}
	if !strings.Contains(prepared.Messages[0].Content, "senior release engineer") {
		t.Fatalf("expert message missing instructions: %q", prepared.Messages[0].Content)
	}
	if prepared.Messages[len(prepared.Messages)-1].Content != "Diagnose this build failure." {
		t.Fatalf("expected user message to be retained")
	}
}

func containsStoreMessage(messages []store.Message, target store.Message) bool {
	for _, message := range messages {
		if storeMessageKey(message) == storeMessageKey(target) {
			return true
		}
	}

	return false
}

func containsContextWarning(warnings []store.ContextWarning, kind string) bool {
	for _, warning := range warnings {
		if warning.Kind == kind {
			return true
		}
	}

	return false
}
