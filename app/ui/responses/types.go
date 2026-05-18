//go:build windows || darwin

package responses

import (
	"time"

	"github.com/ollama/ollama/app/store"
	"github.com/ollama/ollama/types/model"
)

type ChatInfo struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	UserExcerpt string    `json:"userExcerpt"`
	CreatedAt   time.Time `json:"createdAt" ts_type:"Date" ts_transform:"new Date(__VALUE__)"`
	UpdatedAt   time.Time `json:"updatedAt" ts_type:"Date" ts_transform:"new Date(__VALUE__)"`
}

type ChatsResponse struct {
	ChatInfos []ChatInfo `json:"chatInfos"`
}

type ChatResponse struct {
	Chat store.Chat `json:"chat"`
}

type Model struct {
	Model      string     `json:"model"`
	Digest     string     `json:"digest,omitempty"`
	ModifiedAt *time.Time `json:"modified_at,omitempty"`
}

type ModelsResponse struct {
	Models []Model `json:"models"`
}

type InferenceCompute struct {
	Library string `json:"library"`
	Variant string `json:"variant"`
	Compute string `json:"compute"`
	Driver  string `json:"driver"`
	Name    string `json:"name"`
	VRAM    string `json:"vram"`
}

type InferenceComputeResponse struct {
	InferenceComputes    []InferenceCompute `json:"inferenceComputes"`
	DefaultContextLength int                `json:"defaultContextLength"`
}

type ModelCapabilitiesResponse struct {
	Capabilities []model.Capability `json:"capabilities"`
}

// ChatEvent is for regular chat messages and assistant interactions
type ChatEvent struct {
	EventName string `json:"eventName" ts_type:"\"chat\" | \"thinking\" | \"assistant_with_tools\" | \"tool_call\" | \"tool\" | \"tool_result\" | \"done\" | \"chat_created\""`

	// Chat/Assistant message fields
	Content           *string                `json:"content,omitempty"`
	Thinking          *string                `json:"thinking,omitempty"`
	Attachments       []ChatEventAttachment  `json:"attachments,omitempty"`
	ThinkingTimeStart *time.Time             `json:"thinkingTimeStart,omitempty" ts_type:"Date | undefined" ts_transform:"__VALUE__ && new Date(__VALUE__)"`
	ThinkingTimeEnd   *time.Time             `json:"thinkingTimeEnd,omitempty" ts_type:"Date | undefined" ts_transform:"__VALUE__ && new Date(__VALUE__)"`
	Stats             *store.ResponseStats   `json:"stats,omitempty"`
	ContextNotice     *store.ContextNotice   `json:"contextNotice,omitempty"`
	ContextWarnings   []store.ContextWarning `json:"contextWarnings,omitempty"`

	// Tool-related fields
	ToolCalls      []store.ToolCall `json:"toolCalls,omitempty"`
	ToolCall       *store.ToolCall  `json:"toolCall,omitempty"`
	ToolName       *string          `json:"toolName,omitempty"`
	ToolResult     *bool            `json:"toolResult,omitempty"`
	ToolResultData any              `json:"toolResultData,omitempty"`

	// Chat creation fields
	ChatID *string `json:"chatId,omitempty"`

	// Tool state field from the new code
	ToolState any `json:"toolState,omitempty"`
}

type ChatEventAttachment struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
	Size     int    `json:"size"`
	Kind     string `json:"kind"`
	Data     string `json:"data,omitempty"`
}

// DownloadEvent is for model download progress
type DownloadEvent struct {
	EventName string `json:"eventName" ts_type:"\"download\""`
	Total     int64  `json:"total" ts_type:"number"`
	Completed int64  `json:"completed" ts_type:"number"`
	Done      bool   `json:"done" ts_type:"boolean"`
}

// ErrorEvent is for error messages
type ErrorEvent struct {
	EventName string `json:"eventName" ts_type:"\"error\""`
	Error     string `json:"error"`
	Code      string `json:"code,omitempty"`    // Optional error code for different error types
	Details   string `json:"details,omitempty"` // Optional additional details
}

type SettingsResponse struct {
	Settings store.Settings `json:"settings"`
}

type HealthResponse struct {
	Healthy bool `json:"healthy"`
}

type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Bio       string `json:"bio,omitempty"`
	AvatarURL string `json:"avatarurl,omitempty"`
	FirstName string `json:"firstname,omitempty"`
	LastName  string `json:"lastname,omitempty"`
	Plan      string `json:"plan,omitempty"`
}

type Attachment struct {
	Filename string `json:"filename"`
	Data     string `json:"data,omitempty"` // omitempty = optional, no data = existing file reference
}

type ChatRequest struct {
	Model                    string         `json:"model"`
	Prompt                   string         `json:"prompt"`
	Index                    *int           `json:"index,omitempty"`
	Attachments              []Attachment   `json:"attachments,omitempty"`
	Width                    int32          `json:"width,omitempty"`
	Height                   int32          `json:"height,omitempty"`
	Steps                    int32          `json:"steps,omitempty"`
	WebSearch                *bool          `json:"web_search,omitempty"`
	FileTools                *bool          `json:"file_tools,omitempty"`
	ForceUpdate              bool           `json:"forceUpdate,omitempty"`
	Think                    any            `json:"think,omitempty"`
	ContextMode              string         `json:"contextMode,omitempty"`
	NumCtx                   *int           `json:"numCtx,omitempty"`
	NumPredict               *int           `json:"numPredict,omitempty"`
	ReserveOutputTokens      int            `json:"reserveOutputTokens,omitempty"`
	NearFullThresholdPercent int            `json:"nearFullThresholdPercent,omitempty"`
	EnableAutoTrim           *bool          `json:"enableAutoTrim,omitempty"`
	EnableAutoSummarize      *bool          `json:"enableAutoSummarize,omitempty"`
	EnableRetrieval          *bool          `json:"enableRetrieval,omitempty"`
	RetrievalScope           string         `json:"retrievalScope,omitempty"`
	RetrievalChatIDs         []string       `json:"retrievalChatIds,omitempty"`
	RetrievalExcludedChatIDs []string       `json:"retrievalExcludedChatIds,omitempty"`
	RetrievalLimit           int            `json:"retrievalLimit,omitempty"`
	ExpertMode               *bool          `json:"expertMode,omitempty"`
	ExpertInstructions       string         `json:"expertInstructions,omitempty"`
	WebSearchContext         string         `json:"webSearchContext,omitempty"`
	WebSearchMode            string         `json:"webSearchMode,omitempty"`
	WebSearchProvider        string         `json:"webSearchProvider,omitempty"`
	WebSearchResults         []SearchResult `json:"webSearchResults,omitempty"`
	WebSearchError           string         `json:"webSearchError,omitempty"`
	WebSearchReason          string         `json:"webSearchReason,omitempty"`
	WebSearchSearched        *bool          `json:"webSearchSearched,omitempty"`
}

type SearchResult struct {
	Title         string   `json:"title"`
	URL           string   `json:"url"`
	Content       string   `json:"content"`
	Source        string   `json:"source,omitempty"`
	Engine        string   `json:"engine,omitempty"`
	Score         *float64 `json:"score,omitempty"`
	PublishedDate string   `json:"publishedDate,omitempty"`
}

type SearchResponse struct {
	Provider string         `json:"provider"`
	Query    string         `json:"query"`
	Disabled bool           `json:"disabled"`
	Results  []SearchResult `json:"results"`
	Message  string         `json:"message,omitempty"`
	Error    string         `json:"error,omitempty"`
}

type SearchHealthResponse struct {
	Provider   string  `json:"provider"`
	Configured bool    `json:"configured"`
	Reachable  bool    `json:"reachable"`
	Error      *string `json:"error"`
}

type Error struct {
	Error string `json:"error"`
}

type ModelUpstreamResponse struct {
	Stale bool   `json:"stale"`
	Error string `json:"error,omitempty"`
}

// Serializable data for the browser state
type BrowserStateData struct {
	PageStack  []string         `json:"page_stack"`  // Sequential list of page URLs
	ViewTokens int              `json:"view_tokens"` // Number of tokens to show in viewport
	URLToPage  map[string]*Page `json:"url_to_page"` // URL to page contents
}

// Page represents the contents of a page
type Page struct {
	URL       string         `json:"url"`
	Title     string         `json:"title"`
	Text      string         `json:"text"`
	Lines     []string       `json:"lines"`
	Links     map[int]string `json:"links,omitempty" ts_type:"Record<number, string>"`
	FetchedAt time.Time      `json:"fetched_at"`
}
