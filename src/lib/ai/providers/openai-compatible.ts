import { parseAIProviderOutput } from "../provider-output";
import type { AIProvider, AIProviderOutput, AIProviderRequest } from "../types";

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

function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      } catch {
        // Cai no erro estável abaixo.
      }
    }
    throw new Error("O provider retornou uma resposta fora do formato JSON esperado.");
  }
}

function parseCompletionBody(raw: string): ChatCompletionResponse {
  try {
    return JSON.parse(raw) as ChatCompletionResponse;
  } catch {
    throw new Error("O provider de IA retornou uma resposta HTTP inválida.");
  }
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = "openai-compatible";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async generate(input: AIProviderRequest): Promise<AIProviderOutput> {
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

    const rawBody = await response.text();
    const body = parseCompletionBody(rawBody);
    if (!response.ok) {
      throw new Error(body.error?.message || `Falha no provider de IA (${response.status}).`);
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("O provider de IA retornou uma resposta vazia.");

    return parseAIProviderOutput(extractJsonObject(content));
  }
}
