import { parseAIProviderOutput } from "../provider-output";
import type { AIProvider, AIProviderOutput, AIProviderRequest } from "../types";

interface ChatCompletionResponse {
  model?: string;
  provider?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

type ProviderSort = "price" | "throughput" | "latency";

interface ProviderRoutingPreference {
  sort?: ProviderSort;
  allowFallbacks?: boolean;
  requireParameters?: boolean;
}

interface StructuredResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    strict?: boolean;
    schema: unknown;
  };
}

interface ProviderPlugin {
  id: string;
}

interface ChatCompletionRequest {
  model: string;
  temperature: number;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_tokens?: number;
  provider?: {
    sort?: ProviderSort;
    allow_fallbacks?: boolean;
    require_parameters?: boolean;
  };
  response_format?: StructuredResponseFormat;
  plugins?: ProviderPlugin[];
}

export interface OpenAICompatibleProviderOptions {
  id?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxTokens?: number;
  fallbackModels?: string[];
  providerRouting?: ProviderRoutingPreference;
  responseFormat?: StructuredResponseFormat;
  plugins?: ProviderPlugin[];
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

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxTokens?: number;
  private readonly fallbackModels: string[];
  private readonly providerRouting?: ProviderRoutingPreference;
  private readonly responseFormat?: StructuredResponseFormat;
  private readonly plugins: ProviderPlugin[];

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
    options: OpenAICompatibleProviderOptions = {},
  ) {
    this.id = options.id || "openai-compatible";
    this.extraHeaders = options.headers || {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxTokens = options.maxTokens;
    this.fallbackModels = (options.fallbackModels || []).filter(
      (candidate, index, models) => candidate !== model && models.indexOf(candidate) === index,
    );
    this.providerRouting = options.providerRouting;
    this.responseFormat = options.responseFormat;
    this.plugins = options.plugins || [];
  }

  private async generateWithModel(
    model: string,
    input: AIProviderRequest,
  ): Promise<AIProviderOutput> {
    const payload: ChatCompletionRequest = {
      model,
      temperature: 0.25,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
      ...(this.maxTokens ? { max_tokens: this.maxTokens } : {}),
      ...(this.providerRouting
        ? {
            provider: {
              ...(this.providerRouting.sort ? { sort: this.providerRouting.sort } : {}),
              ...(this.providerRouting.allowFallbacks !== undefined
                ? { allow_fallbacks: this.providerRouting.allowFallbacks }
                : {}),
              ...(this.providerRouting.requireParameters !== undefined
                ? { require_parameters: this.providerRouting.requireParameters }
                : {}),
            },
          }
        : {}),
      ...(this.responseFormat ? { response_format: this.responseFormat } : {}),
      ...(this.plugins.length ? { plugins: this.plugins } : {}),
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new Error(
          `O provider de IA excedeu o limite de ${Math.round(this.timeoutMs / 1000)}s.`,
          { cause: error },
        );
      }
      throw error;
    }

    const rawBody = await response.text();
    const body = parseCompletionBody(rawBody);
    if (!response.ok) {
      throw new Error(body.error?.message || `Falha no provider de IA (${response.status}).`);
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("O provider de IA retornou uma resposta vazia.");

    const parsed = parseAIProviderOutput(extractJsonObject(content));
    if (this.id === "openrouter") {
      console.info("student-ai:provider-success", {
        model: body.model || model,
        endpoint: body.provider || null,
      });
    }
    return parsed;
  }

  async generate(input: AIProviderRequest): Promise<AIProviderOutput> {
    const models = [this.model, ...this.fallbackModels];
    let lastError: unknown;

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      try {
        return await this.generateWithModel(model, input);
      } catch (error) {
        lastError = error;
        const nextModel = models[index + 1];
        if (!nextModel) throw error;
        console.warn(`student-ai:model-fallback ${model} -> ${nextModel}`, error);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Falha no provider de IA.");
  }
}
