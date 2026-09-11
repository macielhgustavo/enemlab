import { describe, expect, it } from "vitest";
import { parseAIProviderOutput } from "./provider-output";

const validOutput = {
  title: "Pista",
  explanation: "Observe a relação principal do enunciado.",
  concepts: ["porcentagem"],
  nextStep: "Calcule primeiro a variação relativa.",
  revealAnswer: false,
};

describe("AI provider output boundary", () => {
  it("aceita somente a estrutura pedagógica prevista", () => {
    expect(parseAIProviderOutput(validOutput)).toEqual(validOutput);
  });

  it("aceita highlights semânticos dentro do contrato", () => {
    const withHighlights = {
      ...validOutput,
      highlights: [
        {
          text: "a variação relativa",
          role: "concept" as const,
          note: "Conceito que organiza a leitura deste trecho.",
        },
      ],
    };
    expect(parseAIProviderOutput(withHighlights)).toEqual(withHighlights);
  });

  it("rejeita papel semântico fora do vocabulário permitido", () => {
    expect(() =>
      parseAIProviderOutput({
        ...validOutput,
        highlights: [
          {
            text: "a variação relativa",
            role: "answer",
            note: "Não pode transformar highlight em gabarito.",
          },
        ],
      }),
    ).toThrow(/contrato estruturado/i);
  });

  it("rejeita campos de política que pertencem ao ENEMLab", () => {
    expect(() =>
      parseAIProviderOutput({
        ...validOutput,
        level: 6,
        mode: "chat",
        provider: "inventado",
      }),
    ).toThrow(/contrato estruturado/i);
  });

  it("rejeita metadados oficiais fabricados dentro de questão gerada", () => {
    expect(() =>
      parseAIProviderOutput({
        ...validOutput,
        generatedQuestion: {
          statement: "Questão simulada.",
          alternatives: [
            { letter: "A", text: "Alternativa A" },
            { letter: "B", text: "Alternativa B" },
          ],
          correctAnswer: "B",
          institution: "ENEM",
          year: 2026,
        },
      }),
    ).toThrow(/contrato estruturado/i);
  });

  it("rejeita respostas incompletas ou com tipos errados", () => {
    expect(() =>
      parseAIProviderOutput({
        ...validOutput,
        concepts: "porcentagem",
      }),
    ).toThrow(/contrato estruturado/i);
  });
});
