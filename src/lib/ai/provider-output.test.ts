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
