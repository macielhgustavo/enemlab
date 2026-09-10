import type { AIProvider } from "../types";
import { MockAIProvider } from "./mock";
import { OpenAICompatibleProvider } from "./openai-compatible";

export function getAIProvider(): AIProvider {
  const provider = (process.env.ENEMLAB_AI_PROVIDER || "mock").toLowerCase();

  if (provider === "mock") return new MockAIProvider();

  if (provider === "openai-compatible") {
    const apiKey = process.env.ENEMLAB_AI_API_KEY;
    const model = process.env.ENEMLAB_AI_MODEL;
    const baseUrl = process.env.ENEMLAB_AI_BASE_URL || "https://api.openai.com/v1";
    if (!apiKey || !model) {
      throw new Error(
        "Configure ENEMLAB_AI_API_KEY e ENEMLAB_AI_MODEL para usar ENEMLAB_AI_PROVIDER=openai-compatible.",
      );
    }
    return new OpenAICompatibleProvider(apiKey, model, baseUrl);
  }

  throw new Error(`Provider de IA não suportado: ${provider}`);
}
