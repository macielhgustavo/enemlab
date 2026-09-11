import { sanitizeProviderOutputForLeaks } from "./leakage";
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
  if (configured === "true") return true;
  if (configured === "false") return false;
  if (vercelEnv === "preview") return true;
  return nodeEnv === "development" || nodeEnv === "test";
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
    const safeRaw = sanitizeProviderOutputForLeaks(
      raw,
      request.question,
      policy.revealAnswer,
    );
    return enforcePedagogicalResponse(safeRaw, request, policy, selectedProvider.id);
  } catch (error) {
    if (!shouldFallbackToMock(selectedProvider.id)) throw error;
    console.warn(`student-ai:fallback ${selectedProvider.id} -> mock`, error);
    const fallback = new MockAIProvider();
    const raw = parseAIProviderOutput(await fallback.generate(providerRequest));
    const safeRaw = sanitizeProviderOutputForLeaks(
      raw,
      request.question,
      policy.revealAnswer,
    );
    return {
      ...enforcePedagogicalResponse(safeRaw, request, policy, fallback.id),
      fallbackFrom: selectedProvider.id,
    };
  }
}
