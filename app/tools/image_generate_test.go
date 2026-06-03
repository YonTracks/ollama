//go:build windows || darwin

package tools

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestImageGenerateToolDefaultsAndAttachment(t *testing.T) {
	var gotReq ImageGenerateRequest
	tool := NewImageGenerateTool(func(_ context.Context, req ImageGenerateRequest) (*GeneratedImage, error) {
		gotReq = req
		return &GeneratedImage{Data: []byte("png bytes"), MimeType: "image/png"}, nil
	})

	result, content, err := tool.Execute(t.Context(), map[string]any{
		"prompt": "a blue vase on a wooden table",
	})
	if err != nil {
		t.Fatalf("image.generate failed: %v", err)
	}

	if gotReq.Model != defaultImageGenerateModel {
		t.Fatalf("model = %q, want %q", gotReq.Model, defaultImageGenerateModel)
	}
	if gotReq.Width != defaultImageGenerateWidth || gotReq.Height != defaultImageGenerateHeight || gotReq.Steps != flux2KleinGenerateSteps {
		t.Fatalf("request dimensions = %dx%d steps=%d, want %dx%d steps=%d", gotReq.Width, gotReq.Height, gotReq.Steps, defaultImageGenerateWidth, defaultImageGenerateHeight, flux2KleinGenerateSteps)
	}

	imageResult := result.(*ImageGenerateResult)
	if imageResult.Filename != "generated-image.png" || imageResult.MimeType != "image/png" || imageResult.Size != len("png bytes") {
		t.Fatalf("unexpected result: %#v", imageResult)
	}
	if !strings.Contains(content, "generated-image.png") {
		t.Fatalf("content = %q, want filename", content)
	}

	attachments := imageResult.ToolAttachments()
	if len(attachments) != 1 {
		t.Fatalf("attachments = %d, want 1", len(attachments))
	}
	if !bytes.Equal(attachments[0].Data, []byte("png bytes")) {
		t.Fatalf("attachment data = %q, want png bytes", attachments[0].Data)
	}
}

func TestImageGenerateToolUsesGenericDefaultStepsForNonKleinImageModels(t *testing.T) {
	var gotReq ImageGenerateRequest
	tool := NewImageGenerateTool(func(_ context.Context, req ImageGenerateRequest) (*GeneratedImage, error) {
		gotReq = req
		return &GeneratedImage{Data: []byte("image"), MimeType: "image/png"}, nil
	})

	_, _, err := tool.Execute(t.Context(), map[string]any{
		"prompt": "a bright robot",
		"model":  "x/z-image-turbo:latest",
	})
	if err != nil {
		t.Fatalf("image.generate failed: %v", err)
	}
	if gotReq.Steps != defaultImageGenerateSteps {
		t.Fatalf("steps = %d, want %d", gotReq.Steps, defaultImageGenerateSteps)
	}
}

func TestImageGenerateToolRejectsNonImageModel(t *testing.T) {
	tool := NewImageGenerateTool(func(_ context.Context, req ImageGenerateRequest) (*GeneratedImage, error) {
		t.Fatalf("generate should not be called for model %q", req.Model)
		return nil, nil
	})

	_, _, err := tool.Execute(t.Context(), map[string]any{
		"prompt": "a blue vase",
		"model":  "llama3.2",
	})
	if err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("expected not allowed error, got %v", err)
	}
}

func TestImageGenerateToolClampsOptions(t *testing.T) {
	var gotReq ImageGenerateRequest
	tool := NewImageGenerateTool(func(_ context.Context, req ImageGenerateRequest) (*GeneratedImage, error) {
		gotReq = req
		return &GeneratedImage{Data: []byte("image"), MimeType: "image/webp"}, nil
	})

	result, _, err := tool.Execute(t.Context(), map[string]any{
		"prompt": "wide scene",
		"model":  "x/z-image-turbo:latest",
		"width":  float64(4096),
		"height": float64(12),
		"steps":  float64(500),
	})
	if err != nil {
		t.Fatalf("image.generate failed: %v", err)
	}

	if gotReq.Width != 2048 || gotReq.Height != 64 || gotReq.Steps != 100 {
		t.Fatalf("clamped request = %dx%d steps=%d, want 2048x64 steps=100", gotReq.Width, gotReq.Height, gotReq.Steps)
	}
	if result.(*ImageGenerateResult).Filename != "generated-image.webp" {
		t.Fatalf("filename = %q, want generated-image.webp", result.(*ImageGenerateResult).Filename)
	}
}
