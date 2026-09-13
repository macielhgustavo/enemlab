import { describe, expect, it } from "vitest";
import type { Question } from "../domain/types";
import { classifyContent, classifyQuestion } from "../domain/classify";
import { classifyContent as baseClassifyContent } from "../domain/classify-base";
import {
  unesp2026AcademicCount,
  unesp2026AcademicMetadata,
} from "./unesp-2026";

function unespQuestion(number: number): Question {
  return {
    providerId: "unesp",
    year: 2026,
    phase: "first",
    index: number,
    number,
    discipline: "conhecimentos-gerais",
    statementAvailable: false,
    alternatives: ["A", "B", "C", "D", "E"].map((letter) => ({ letter, text: "" })),
  };
}

describe("reviewed academic metadata", () => {
  it("cobre exatamente as 90 questões da UNESP 2026", () => {
    expect(unesp2026AcademicCount()).toBe(90);
    expect(unesp2026AcademicMetadata(0)).toBeNull();
    expect(unesp2026AcademicMetadata(91)).toBeNull();
  });

  it("classifica reference-only sem depender do texto protegido", () => {
    const chemistry = classifyQuestion(unespQuestion(71));
    expect(chemistry.primary).toBe("Química");
    expect(chemistry.subtopic).toBe("Estequiometria e eletroquímica");
    expect(chemistry.confidence).toBe("alta");
    expect(chemistry.evidence[0]).toMatch(/revisada/i);

    expect(classifyContent(unespQuestion(90))).toBe("Matemática");
  });

  it("mantém o classificador histórico como fallback fora do mapa revisado", () => {
    const question: Question = {
      providerId: "enem",
      year: 2023,
      index: 1,
      discipline: "matematica",
      context: "Uma função quadrática é analisada em um intervalo.",
      alternatives: [],
    };
    expect(classifyContent(question)).toBe(baseClassifyContent(question));
  });
});
