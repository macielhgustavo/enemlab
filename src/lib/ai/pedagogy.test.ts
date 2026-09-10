import { describe, expect, it } from "vitest";
import { buildPedagogicalPolicy, enforcePedagogicalResponse, normalizeGeneratedQuestion } from "./pedagogy";
import type { AIRequest } from "./types";

function request(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    mode: "hint",
    question: {
      key: "2023-1",
      origin: { kind: "official", institution: "ENEM", year: 2023, questionNumber: 1 },
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

describe("pedagogical engine", () => {
  it("mantém dica no nível 1 sem revelar gabarito", () => {
    const input = request({ mode: "hint" });
    const policy = buildPedagogicalPolicy(input);
    const result = enforcePedagogicalResponse(
      {
        title: "Teste",
        explanation: "Explicação",
        concepts: ["Porcentagem"],
        nextStep: "Continue",
        revealAnswer: true,
        answer: "B",
      },
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

  it("força proveniência correta para questão gerada", () => {
    const generated = normalizeGeneratedQuestion({
      origin: "ai-generated",
      label: "Questão gerada por IA — estilo ENEM",
      style: "ENEM",
      statement: "Simulada",
      alternatives: [
        { letter: "A", text: "Um" },
        { letter: "B", text: "Dois" },
      ],
      correctAnswer: "B",
    });
    expect(generated?.origin).toBe("ai-generated");
    expect(generated?.label).toBe("Questão gerada por IA — estilo ENEM");
  });
});
