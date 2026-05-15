import type { OllamaModel } from "./types";

const IMAGE_GENERATION_MODEL_PATTERNS = [
  /^x\/flux/i,
  /^x\/z-image/i,
  /flux2?-klein/i,
  /z-image/i
];

export function isImageGenerationModel(model: OllamaModel | string | undefined) {
  const name = typeof model === "string" ? model : model?.name;
  if (!name) return false;

  return IMAGE_GENERATION_MODEL_PATTERNS.some((pattern) => pattern.test(name));
}
