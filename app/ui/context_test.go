//go:build windows || darwin

package ui

import (
	"strings"
	"testing"

	"github.com/ollama/ollama/app/store"
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
