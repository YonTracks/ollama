import { describe, expect, it } from "vitest";
import { isImageGenerationModel } from "./models";

describe("model helpers", () => {
  it("detects Ollama image generation models by name", () => {
    expect(isImageGenerationModel("x/flux2-klein")).toBe(true);
    expect(isImageGenerationModel("x/z-image-turbo")).toBe(true);
    expect(isImageGenerationModel("llava")).toBe(false);
    expect(isImageGenerationModel("llama3.2")).toBe(false);
  });
});
