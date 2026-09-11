import { describe, expect, it } from "vitest";
import {
  esaAnswerKey,
  esaExamUrl,
  esaProvider,
  esaQuestionKey,
  esaQuestions,
  esaYears,
} from ".";

describe("ESA Geral 2025 — Tipo A", () => {
  it("expõe apenas a edição validada", () => {
    expect(esaYears()).toEqual([2025]);
    const key = esaAnswerKey(2025)!;
    expect(key.revision).toBe("final-2025-10-14");
    expect(key.variant).toBe("A");
    expect(key.total).toBe(50);
    expect(key.annulled).toEqual([1, 4, 10]);
  });

  it("gera 50 questões e respeita as faixas oficiais de matéria", () => {
    const questions = esaQuestions(2025);
    expect(questions).toHaveLength(50);
    expect(questions.find((q) => q.number === 14)?.subject.id).toBe("mathematics");
    expect(questions.find((q) => q.number === 15)?.subject.id).toBe("portuguese");
    expect(questions.find((q) => q.number === 29)?.subject.id).toBe("history_geography");
    expect(questions.find((q) => q.number === 41)?.subject.id).toBe("english");
  });

  it("mantém as questões anuladas sem alternativa correta", () => {
    for (const number of [1, 4, 10]) {
      const question = esaQuestions(2025).find((q) => q.number === number)!;
      expect(question.correctAlternative).toBeNull();
      expect(question.alternatives.every((a) => !a.isCorrect)).toBe(true);
    }
  });

  it("carrega respostas definitivas transcritas do Tipo A", () => {
    const questions = esaQuestions(2025);
    expect(questions.find((q) => q.number === 2)?.correctAlternative).toBe("C");
    expect(questions.find((q) => q.number === 15)?.correctAlternative).toBe("B");
    expect(questions.find((q) => q.number === 41)?.correctAlternative).toBe("A");
    expect(questions.find((q) => q.number === 50)?.correctAlternative).toBe("C");
  });

  it("não finge que o espelho é a URL oficial", () => {
    const question = esaQuestions(2025)[0];
    expect(question.statementAvailable).toBe(false);
    expect(question.official?.official).toBe(false);
    expect(question.official?.documentUrl).toBe(esaExamUrl(2025));
    expect(question.official?.documentUrl).toContain("arquivos.qconcursos.com");
  });

  it("usa chave estável por ano, fase e número", () => {
    expect(esaQuestionKey(esaQuestions(2025)[0])).toBe("esa-2025-single-1");
  });

  it("provider entrega 2025 e recusa ano não ingerido", async () => {
    expect(await esaProvider.fetchQuestions({ year: 2025 })).toHaveLength(50);
    expect(await esaProvider.fetchQuestions({ year: 2024 })).toEqual([]);
  });
});
