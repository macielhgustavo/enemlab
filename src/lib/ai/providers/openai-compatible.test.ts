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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleProvider", () => {
  it("permite identidade e headers específicos sem duplicar o transporte", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
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
      ),
    );
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
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("provider/model");
    expect(body.messages.map((message) => message.role)).toEqual(["system", "user"]);
  });
});
