import { describe, expect, it } from "vitest";
import { imageGenerationDefaultSteps, isFlux2KleinModel, isImageGenerationModel } from "./models";

describe("model helpers", () => {
  it("detects Ollama image generation models by name", () => {
    expect(isImageGenerationModel("x/flux2-klein")).toBe(true);
    expect(isImageGenerationModel("x/z-image-turbo")).toBe(true);
    expect(isImageGenerationModel("llava")).toBe(false);
    expect(isImageGenerationModel("llama3.2")).toBe(false);
  });

  it("uses the Klein-native image generation step default", () => {
    expect(isFlux2KleinModel("x/flux2-klein")).toBe(true);
    expect(isFlux2KleinModel("x/flux-klein")).toBe(true);
    expect(isFlux2KleinModel("x/z-image-turbo")).toBe(false);
    expect(imageGenerationDefaultSteps("x/flux2-klein")).toBe(4);
    expect(imageGenerationDefaultSteps("x/z-image-turbo")).toBe(20);
  });
});
