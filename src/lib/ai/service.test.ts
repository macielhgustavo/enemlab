import { afterEach, describe, expect, it } from "vitest";
import { runStudentAI, shouldFallbackToMock } from "./service";
import type { AIProvider, AIProviderOutput, AIRequest } from "./types";

const request: AIRequest = {
  mode: "hint",
  question: {
    key: "enem-2023-1",
    origin: {
      kind: "official",
      providerId: "enem",
      institution: "ENEM",
      year: 2023,
      questionNumber: 1,
    },
    statement: "Uma questão de teste sobre porcentagem.",
    alternatives: [
      { letter: "A", text: "10%" },
      { letter: "B", text: "20%" },
    ],
    correctAnswer: "B",
    subject: "Matemática",
    topic: "Porcentagem",
  },
};

class FailingProvider implements AIProvider {
  readonly id = "failing-provider";

  async generate(): Promise<AIProviderOutput> {
    throw new Error("provider indisponível");
  }
}

const originalFallback = process.env.ENEMLAB_AI_FALLBACK_TO_MOCK;

afterEach(() => {
  if (originalFallback === undefined) delete process.env.ENEMLAB_AI_FALLBACK_TO_MOCK;
  else process.env.ENEMLAB_AI_FALLBACK_TO_MOCK = originalFallback;
});

describe("Student AI provider fallback", () => {
  it("é automático fora de produção, inclusive em Preview da Vercel", () => {
    expect(shouldFallbackToMock("external", undefined, "development")).toBe(true);
    expect(shouldFallbackToMock("external", undefined, "test")).toBe(true);
    expect(shouldFallbackToMock("external", undefined, "production", "preview")).toBe(true);
    expect(shouldFallbackToMock("external", undefined, "production", "production")).toBe(false);
    expect(shouldFallbackToMock("external", undefined, "production")).toBe(false);
    expect(shouldFallbackToMock("mock", "true", "production", "preview")).toBe(false);
  });

  it("respeita configuração explícita", () => {
    expect(shouldFallbackToMock("external", "true", "production", "production")).toBe(true);
    expect(shouldFallbackToMock("external", "false", "development", "preview")).toBe(false);
  });

  it("usa mock de contingência e informa qual provider falhou", async () => {
    process.env.ENEMLAB_AI_FALLBACK_TO_MOCK = "true";
    const response = await runStudentAI(request, new FailingProvider());

    expect(response.provider).toBe("mock");
    expect(response.fallbackFrom).toBe("failing-provider");
    expect(response.mode).toBe("hint");
    expect(response.level).toBe(1);
    expect(response.revealAnswer).toBe(false);
  });
});
