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

function successfulResponse() {
  return new Response(
    JSON.stringify({
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleProvider", () => {
  it("permite identidade, headers e roteamento específicos sem duplicar o transporte", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse());
    vi.stubGlobal("fetch", fetchMock);

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
        maxTokens: 700,
        providerRouting: {
          sort: "latency",
          allowFallbacks: true,
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
      max_tokens?: number;
      provider?: { sort?: string; allow_fallbacks?: boolean };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("provider/model");
    expect(body.max_tokens).toBe(700);
    expect(body.provider).toEqual({ sort: "latency", allow_fallbacks: true });
    expect(body.messages.map((message) => message.role)).toEqual(["system", "user"]);
  });

  it("tenta um modelo alternativo quando o modelo principal excede o tempo", async () => {
    const timeout = Object.assign(new Error("slow provider"), { name: "TimeoutError" });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(successfulResponse());
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleProvider(
      "secret",
      "provider/slow-free",
      "https://openrouter.ai/api/v1",
      {
        id: "openrouter",
        timeoutMs: 12_000,
        fallbackModels: ["openrouter/free"],
      },
    );

    const result = await provider.generate(providerRequest());
    expect(result.title).toBe("Pista");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { model: string };
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { model: string };
    expect(firstBody.model).toBe("provider/slow-free");
    expect(secondBody.model).toBe("openrouter/free");
  });
});
