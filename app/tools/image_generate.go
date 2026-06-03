//go:build windows || darwin

package tools

import (
	"context"
	"fmt"
	"strings"
)

const (
	defaultImageGenerateModel  = "x/flux2-klein:latest"
	defaultImageGenerateWidth  = 512
	defaultImageGenerateHeight = 512
	defaultImageGenerateSteps  = 20
	flux2KleinGenerateSteps    = 4
)

type ToolAttachment struct {
	Filename string
	MimeType string
	Data     []byte
}

type AttachmentProvider interface {
	ToolAttachments() []ToolAttachment
}

type ImageGenerateRequest struct {
	Model  string
	Prompt string
	Width  int32
	Height int32
	Steps  int32
}

type GeneratedImage struct {
	Data     []byte
	MimeType string
}

type ImageGenerateFunc func(context.Context, ImageGenerateRequest) (*GeneratedImage, error)

type ImageGenerateTool struct {
	generate ImageGenerateFunc
}

type ImageGenerateResult struct {
	Model    string `json:"model"`
	Prompt   string `json:"prompt"`
	Filename string `json:"filename"`
	MimeType string `json:"mime_type"`
	Size     int    `json:"size"`
	Width    int32  `json:"width"`
	Height   int32  `json:"height"`
	Steps    int32  `json:"steps"`

	attachment ToolAttachment
}

func (r *ImageGenerateResult) ToolAttachments() []ToolAttachment {
	if r == nil || len(r.attachment.Data) == 0 {
		return nil
	}
	return []ToolAttachment{r.attachment}
}

func NewImageGenerateTool(generate ImageGenerateFunc) *ImageGenerateTool {
	return &ImageGenerateTool{generate: generate}
}

func (t *ImageGenerateTool) Name() string {
	return "image.generate"
}

func (t *ImageGenerateTool) Description() string {
	return "Generate a single image using an allowed local image generation model and attach it to the chat. For ordinary requests, provide only prompt and omit optional model, width, height, and steps."
}

func (t *ImageGenerateTool) Prompt() string {
	return ""
}

func (t *ImageGenerateTool) Schema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"prompt": map[string]any{
				"type":        "string",
				"description": "Detailed image prompt to send to the image generation model.",
			},
			"model": map[string]any{
				"type":        "string",
				"description": "Optional allowed local image generation model. Omit unless the user asks for a specific image model. Defaults to x/flux2-klein:latest.",
				"default":     defaultImageGenerateModel,
			},
			"width": map[string]any{
				"type":        "integer",
				"description": "Optional image width in pixels. Omit unless the user asks for a specific size. Defaults to 512.",
				"default":     defaultImageGenerateWidth,
				"minimum":     64,
				"maximum":     2048,
			},
			"height": map[string]any{
				"type":        "integer",
				"description": "Optional image height in pixels. Omit unless the user asks for a specific size. Defaults to 512.",
				"default":     defaultImageGenerateHeight,
				"minimum":     64,
				"maximum":     2048,
			},
			"steps": map[string]any{
				"type":        "integer",
				"description": "Optional diffusion steps. Omit unless the user asks for quality/speed tuning. Defaults to 4 for x/flux2-klein:latest.",
				"default":     ImageGenerationDefaultSteps(defaultImageGenerateModel),
				"minimum":     1,
				"maximum":     100,
			},
		},
		"required": []string{"prompt"},
	}
}

func (t *ImageGenerateTool) Execute(ctx context.Context, args map[string]any) (any, string, error) {
	if t.generate == nil {
		return nil, "", fmt.Errorf("image generation is not configured")
	}

	prompt := strings.TrimSpace(stringArg(args, "prompt", ""))
	if prompt == "" {
		return nil, "", fmt.Errorf("prompt parameter is required")
	}

	model := strings.TrimSpace(stringArg(args, "model", defaultImageGenerateModel))
	if model == "" {
		model = defaultImageGenerateModel
	}
	if !IsAllowedImageGenerationModel(model) {
		return nil, "", fmt.Errorf("image model %q is not allowed", model)
	}

	req := ImageGenerateRequest{
		Model:  model,
		Prompt: prompt,
		Width:  int32Arg(args, "width", defaultImageGenerateWidth, 64, 2048),
		Height: int32Arg(args, "height", defaultImageGenerateHeight, 64, 2048),
		Steps:  int32Arg(args, "steps", ImageGenerationDefaultSteps(model), 1, 100),
	}

	image, err := t.generate(ctx, req)
	if err != nil {
		return nil, "", err
	}
	if image == nil || len(image.Data) == 0 {
		return nil, "", fmt.Errorf("image generation returned no image")
	}

	mimeType := image.MimeType
	if mimeType == "" {
		mimeType = "image/png"
	}
	filename := generatedImageToolFilename(mimeType)

	result := &ImageGenerateResult{
		Model:    req.Model,
		Prompt:   req.Prompt,
		Filename: filename,
		MimeType: mimeType,
		Size:     len(image.Data),
		Width:    req.Width,
		Height:   req.Height,
		Steps:    req.Steps,
		attachment: ToolAttachment{
			Filename: filename,
			MimeType: mimeType,
			Data:     image.Data,
		},
	}

	return result, fmt.Sprintf("Generated image attached: %s", filename), nil
}

func IsAllowedImageGenerationModel(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	return strings.HasPrefix(lower, "x/flux") ||
		strings.HasPrefix(lower, "x/z-image") ||
		strings.Contains(lower, "flux-klein") ||
		strings.Contains(lower, "flux2-klein") ||
		strings.Contains(lower, "z-image")
}

func ImageGenerationDefaultSteps(name string) int32 {
	lower := strings.ToLower(strings.TrimSpace(name))
	if strings.Contains(lower, "flux-klein") || strings.Contains(lower, "flux2-klein") {
		return flux2KleinGenerateSteps
	}
	return defaultImageGenerateSteps
}

func generatedImageToolFilename(mimeType string) string {
	switch mimeType {
	case "image/jpeg":
		return "generated-image.jpg"
	case "image/webp":
		return "generated-image.webp"
	default:
		return "generated-image.png"
	}
}

func int32Arg(args map[string]any, key string, defaultValue, minValue, maxValue int32) int32 {
	value := defaultValue
	switch v := args[key].(type) {
	case float64:
		value = int32(v)
	case float32:
		value = int32(v)
	case int:
		value = int32(v)
	case int32:
		value = v
	case int64:
		value = int32(v)
	}

	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}
