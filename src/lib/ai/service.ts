import { buildPedagogicalPolicy, buildTutorPrompts, enforcePedagogicalResponse } from "./pedagogy";
import { getAIProvider } from "./providers";
import type { AIProvider, AIRequest, AIResponse } from "./types";

export async function runStudentAI(
  request: AIRequest,
  provider: AIProvider = getAIProvider(),
): Promise<AIResponse> {
  const policy = buildPedagogicalPolicy(request);
  const prompts = buildTutorPrompts(request, policy);
  const raw = await provider.generate({
    request,
    policy,
    ...prompts,
  });
  return enforcePedagogicalResponse(raw, request, policy, provider.id);
}
