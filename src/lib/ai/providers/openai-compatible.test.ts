import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIProviderRequest } from "../types";
import { OpenAICompatibleProvider } from "./openai-compatible";

function providerRequest(): AIProviderRequest {
  return {
    request: {
      mode: "hint",
      question: {
        key: "enem|2023|1",
        origin: {
          kind: "official",
          providerId: "enem",
          institution: "ENEM",
          year: 2023,
          questionNumber: 1,
        },
        statement: "Uma questão de teste.",
        alternatives: [
          { letter: "A", text: "A" },
          { letter: "B", text: "B" },
        ],
        subject: "Matemática",
        topic: "Porcentagem",
      },
    },
    policy: {
      mode: "hint",
      level: 1,
      revealAnswer: false,
      includeCorrectAnswerInModelContext: false,
      objective: "Dar uma pista curta.",
    },
    systemPrompt: "system",
    userPrompt: "user",
  };
}

function successResponse() {
  return new Response(
    JSON.stringify({
      model: "free/structured-model",
      provider: "Example",
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "Pista",
              explanation: "Observe a relação entre os valores.",
              concepts: ["Porcentagem"],
              nextStep: "Monte a proporção.",
              revealAnswer: false,
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const responseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "test",
    strict: true,
    schema: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleProvider", () => {
  it("envia structured output, healing e roteamento exigido pelo OpenRouter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const provider = new OpenAICompatibleProvider(
      "secret",
      "provider/model",
      "https://openrouter.ai/api/v1/",
      {
        id: "openrouter",
        headers: {
          "HTTP-Referer": "https://enemlab.example",
          "X-Title": "ENEMLab",
        },
        timeoutMs: 12_000,
        maxTokens: 1_200,
        responseFormat,
        plugins: [{ id: "response-healing" }],
        providerRouting: {
          sort: "latency",
          allowFallbacks: true,
          requireParameters: true,
        },
      },
    );

    const result = await provider.generate(providerRequest());
    expect(provider.id).toBe("openrouter");
    expect(result.title).toBe("Pista");
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer secret");
    expect(headers.get("HTTP-Referer")).toBe("https://enemlab.example");
    expect(headers.get("X-Title")).toBe("ENEMLab");

    const body = JSON.parse(String(init.body)) as {
      model: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
      provider: {
        sort: string;
        allow_fallbacks: boolean;
        require_parameters: boolean;
      };
      response_format: { type: string; json_schema: { strict: boolean } };
      plugins: Array<{ id: string }>;
    };
    expect(body.model).toBe("provider/model");
    expect(body.max_tokens).toBe(1_200);
    expect(body.messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(body.provider).toEqual({
      sort: "latency",
      allow_fallbacks: true,
      require_parameters: true,
    });
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.plugins).toEqual([{ id: "response-healing" }]);
  });

  it("mantém o contrato estruturado ao cair para outro modelo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "response_format não suportado" } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(successResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const provider = new OpenAICompatibleProvider(
      "secret",
      "provider/sem-structured-output",
      "https://openrouter.ai/api/v1",
      {
        id: "openrouter",
        fallbackModels: ["openrouter/free"],
        responseFormat,
        plugins: [{ id: "response-healing" }],
        providerRouting: { requireParameters: true },
      },
    );

    const result = await provider.generate(providerRequest());
    expect(result.title).toBe("Pista");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      model: string;
      response_format: { type: string };
      provider: { require_parameters: boolean };
    };
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      model: string;
      response_format: { type: string };
      provider: { require_parameters: boolean };
    };

    expect(firstBody.model).toBe("provider/sem-structured-output");
    expect(secondBody.model).toBe("openrouter/free");
    expect(firstBody.response_format.type).toBe("json_schema");
    expect(secondBody.response_format.type).toBe("json_schema");
    expect(firstBody.provider.require_parameters).toBe(true);
    expect(secondBody.provider.require_parameters).toBe(true);
  });
});
