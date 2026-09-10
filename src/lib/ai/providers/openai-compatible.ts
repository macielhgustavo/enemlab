import type { AIProvider, AIProviderRequest, AIResponse } from "../types";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

function parseJsonObject(content: string): Partial<AIResponse> {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as Partial<AIResponse>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Partial<AIResponse>;
    }
    throw new Error("O provider retornou uma resposta fora do formato JSON esperado.");
  }
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = "openai-compatible";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async generate(input: AIProviderRequest): Promise<AIResponse> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.25,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const body = (await response.json()) as ChatCompletionResponse;
    if (!response.ok) {
      throw new Error(body.error?.message || `Falha no provider de IA (${response.status}).`);
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("O provider de IA retornou uma resposta vazia.");
    return parseJsonObject(content) as AIResponse;
  }
}
