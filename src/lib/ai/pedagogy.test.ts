import { describe, expect, it } from "vitest";
import {
  buildPedagogicalPolicy,
  enforcePedagogicalResponse,
  generatedQuestionIdentity,
  normalizeGeneratedQuestion,
} from "./pedagogy";
import type { AIProviderOutput, AIRequest } from "./types";

function request(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    mode: "hint",
    question: {
      key: "2023-1",
      origin: {
        kind: "official",
        providerId: "enem",
        institution: "ENEM",
        year: 2023,
        questionNumber: 1,
      },
      statement: "Enunciado",
      alternatives: [
        { letter: "A", text: "A" },
        { letter: "B", text: "B" },
      ],
      correctAnswer: "B",
      selectedAnswer: "A",
      subject: "Matemática",
      topic: "Porcentagem",
    },
    ...overrides,
  };
}

function output(overrides: Partial<AIProviderOutput> = {}): AIProviderOutput {
  return {
    title: "Teste",
    explanation: "Explicação",
    concepts: ["Porcentagem"],
    nextStep: "Continue",
    revealAnswer: false,
    ...overrides,
  };
}

describe("pedagogical engine", () => {
  it("mantém dica no nível 1 sem revelar gabarito", () => {
    const input = request({ mode: "hint" });
    const policy = buildPedagogicalPolicy(input);
    const result = enforcePedagogicalResponse(
      output({ revealAnswer: true, answer: "B" }),
      input,
      policy,
      "fake",
    );
    expect(result.level).toBe(1);
    expect(result.revealAnswer).toBe(false);
    expect(result.answer).toBeUndefined();
  });

  it("permite solução completa quando o aluno pede explicitamente", () => {
    const input = request({ mode: "chat", message: "Resolva completamente essa questão" });
    const policy = buildPedagogicalPolicy(input);
    expect(policy.level).toBe(6);
    expect(policy.revealAnswer).toBe(true);
  });

  it("não libera o gabarito em por-que-errei por padrão", () => {
    const input = request({ mode: "why-wrong" });
    const policy = buildPedagogicalPolicy(input);
    expect(policy.includeCorrectAnswerInModelContext).toBe(true);
    expect(policy.revealAnswer).toBe(false);
  });

  it("descarta diagnóstico enviado durante uma simples pista", () => {
    const input = request({ mode: "hint" });
    const result = enforcePedagogicalResponse(
      output({
        diagnostic: {
          category: "content-gap",
          confidence: "high",
          note: "Suposição indevida do provider.",
        },
      }),
      input,
      buildPedagogicalPolicy(input),
      "fake",
    );
    expect(result.diagnostic).toBeUndefined();
  });

  it("aceita diagnóstico estruturado ao analisar uma resposta marcada", () => {
    const input = request({ mode: "why-wrong", selectedAlternative: "A" });
    const result = enforcePedagogicalResponse(
      output({
        diagnostic: {
          category: "calculation",
          confidence: "high",
          note: "A conta aplicada à alternativa marcada está inconsistente.",
        },
      }),
      input,
      buildPedagogicalPolicy(input),
      "fake",
    );
    expect(result.diagnostic).toMatchObject({
      category: "calculation",
      confidence: "high",
    });
  });

  it("força proveniência de IA usando a prova real apenas como estilo", () => {
    const input = request({
      question: {
        ...request().question,
        origin: {
          kind: "official",
          providerId: "ita",
          institution: "ITA",
          year: 2025,
          questionNumber: 12,
        },
      },
    });
    const generated = normalizeGeneratedQuestion(
      {
        statement: "Simulada",
        alternatives: [
          { letter: "A", text: "Um" },
          { letter: "B", text: "Dois" },
        ],
        correctAnswer: "B",
      },
      input.question,
    );
    expect(generated?.origin).toBe("ai-generated");
    expect(generated?.label).toBe("Questão gerada por IA — estilo ITA");
    expect(generated?.style).toBe("ITA");
  });

  it("deriva o rótulo gerado da instituição de origem", () => {
    expect(generatedQuestionIdentity(request().question).label).toBe(
      "Questão gerada por IA — estilo ENEM",
    );
  });
});
