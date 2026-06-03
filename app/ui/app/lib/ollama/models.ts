import type { OllamaModel } from "./types";

export const DEFAULT_IMAGE_GENERATION_STEPS = 20;
export const FLUX2_KLEIN_DEFAULT_IMAGE_GENERATION_STEPS = 4;

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

export function isFlux2KleinModel(model: OllamaModel | string | undefined) {
  const name = typeof model === "string" ? model : model?.name;
  if (!name) return false;

  return /flux2?-klein/i.test(name);
}

export function imageGenerationDefaultSteps(model: OllamaModel | string | undefined) {
  return isFlux2KleinModel(model)
    ? FLUX2_KLEIN_DEFAULT_IMAGE_GENERATION_STEPS
    : DEFAULT_IMAGE_GENERATION_STEPS;
}
