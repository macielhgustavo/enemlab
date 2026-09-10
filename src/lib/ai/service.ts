import {
  buildPedagogicalPolicy,
  buildTutorPrompts,
  enforcePedagogicalResponse,
  questionContextForModel,
} from "./pedagogy";
import { parseAIProviderOutput } from "./provider-output";
import { getAIProvider } from "./providers";
import { MockAIProvider } from "./providers/mock";
import type { AIProvider, AIProviderRequest, AIRequest, AIResponse } from "./types";

export function shouldFallbackToMock(
  providerId: string,
  configured = process.env.ENEMLAB_AI_FALLBACK_TO_MOCK,
  nodeEnv = process.env.NODE_ENV,
  vercelEnv = process.env.VERCEL_ENV,
): boolean {
  if (providerId === "mock") return false;
  const explicit = configured?.trim().toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  if (vercelEnv === "preview" || vercelEnv === "development") return true;
  return nodeEnv !== "production";
}

export async function runStudentAI(
  request: AIRequest,
  provider?: AIProvider,
): Promise<AIResponse> {
  const selectedProvider = provider ?? getAIProvider();
  const policy = buildPedagogicalPolicy(request);
  const prompts = buildTutorPrompts(request, policy);
  const safeRequest: AIRequest = {
    ...request,
    question: questionContextForModel(request.question, policy),
  };
  const providerRequest: AIProviderRequest = {
    request: safeRequest,
    policy,
    ...prompts,
  };

  try {
    const raw = parseAIProviderOutput(await selectedProvider.generate(providerRequest));
    return enforcePedagogicalResponse(raw, request, policy, selectedProvider.id);
  } catch (error) {
    if (!shouldFallbackToMock(selectedProvider.id)) throw error;

    console.warn(`student-ai:fallback ${selectedProvider.id} -> mock`, error);
    const fallback = new MockAIProvider();
    const raw = parseAIProviderOutput(await fallback.generate(providerRequest));
    return {
      ...enforcePedagogicalResponse(raw, request, policy, fallback.id),
      fallbackFrom: selectedProvider.id,
    };
  }
}
