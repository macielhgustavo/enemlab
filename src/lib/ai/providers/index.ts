import { aiProviderOutputJsonSchema } from "../provider-output";
import type { AIProvider } from "../types";
import { MockAIProvider } from "./mock";
import { OpenAICompatibleProvider } from "./openai-compatible";

const OPENROUTER_FREE_ROUTER = "openrouter/free";

function optionalHeader(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function getAIProvider(): AIProvider {
  const provider = (process.env.ENEMLAB_AI_PROVIDER || "mock").toLowerCase();

  if (provider === "mock") return new MockAIProvider();

  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.ENEMLAB_AI_API_KEY;
    const model = process.env.ENEMLAB_AI_MODEL;
    if (!apiKey || !model) {
      throw new Error(
        "Configure OPENROUTER_API_KEY (ou ENEMLAB_AI_API_KEY) e ENEMLAB_AI_MODEL para usar ENEMLAB_AI_PROVIDER=openrouter.",
      );
    }

    const siteUrl = optionalHeader(process.env.ENEMLAB_AI_SITE_URL);
    const appName = optionalHeader(process.env.ENEMLAB_AI_APP_NAME);
    return new OpenAICompatibleProvider(
      apiKey,
      model,
      "https://openrouter.ai/api/v1",
      {
        id: "openrouter",
        headers: {
          ...(siteUrl ? { "HTTP-Referer": siteUrl } : {}),
          ...(appName ? { "X-Title": appName } : {}),
        },
        timeoutMs: 12_000,
        maxTokens: 1_200,
        fallbackModels: model === OPENROUTER_FREE_ROUTER ? [] : [OPENROUTER_FREE_ROUTER],
        providerRouting: {
          sort: "latency",
          allowFallbacks: true,
          requireParameters: true,
        },
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "enemlab_student_ai",
            strict: true,
            schema: aiProviderOutputJsonSchema,
          },
        },
        plugins: [{ id: "response-healing" }],
      },
    );
  }

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
