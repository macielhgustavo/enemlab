import { describe, expect, it } from "vitest";
import {
  esaAnswerKey,
  esaExamUrl,
  esaProvider,
  esaQuestionKey,
  esaQuestions,
  esaYears,
} from ".";

describe("ESA Geral — Tipo A", () => {
  it("expõe somente as edições validadas", () => {
    expect(esaYears()).toEqual([2025, 2024, 2023]);

    const k23 = esaAnswerKey(2023)!;
    expect(k23.revision).toBe("qconcursos-final-current-2023");
    expect(k23.variant).toBe("A");
    expect(k23.total).toBe(50);
    expect(k23.annulled).toEqual([]);

    const k24 = esaAnswerKey(2024)!;
    expect(k24.revision).toBe("final-2024");
    expect(k24.variant).toBe("A");
    expect(k24.total).toBe(50);
    expect(k24.annulled).toEqual([40]);

    const k25 = esaAnswerKey(2025)!;
    expect(k25.revision).toBe("final-2025-10-14");
    expect(k25.variant).toBe("A");
    expect(k25.total).toBe(50);
    expect(k25.annulled).toEqual([1, 4, 10]);
  });

  it("gera 50 questões por edição e respeita as faixas de matéria", () => {
    for (const year of esaYears()) {
      const questions = esaQuestions(year);
      expect(questions).toHaveLength(50);
      expect(questions.find((q) => q.number === 14)?.subject.id).toBe("mathematics");
      expect(questions.find((q) => q.number === 15)?.subject.id).toBe("portuguese");
      expect(questions.find((q) => q.number === 29)?.subject.id).toBe("history_geography");
      expect(questions.find((q) => q.number === 41)?.subject.id).toBe("english");
    }
  });

  it("mantém as anuladas sem alternativa correta", () => {
    const cases: Array<[number, number[]]> = [
      [2023, []],
      [2024, [40]],
      [2025, [1, 4, 10]],
    ];
    for (const [year, annulled] of cases) {
      for (const number of annulled) {
        const question = esaQuestions(year).find((q) => q.number === number)!;
        expect(question.correctAlternative).toBeNull();
        expect(question.alternatives.every((a) => !a.isCorrect)).toBe(true);
      }
    }
  });

  it("carrega respostas do Tipo A conferidas no espelho", () => {
    const q23 = esaQuestions(2023);
    expect(q23.find((q) => q.number === 1)?.correctAlternative).toBe("C");
    expect(q23.find((q) => q.number === 21)?.correctAlternative).toBe("E");
    expect(q23.find((q) => q.number === 29)?.correctAlternative).toBe("C");
    expect(q23.find((q) => q.number === 41)?.correctAlternative).toBe("E");
    expect(q23.find((q) => q.number === 50)?.correctAlternative).toBe("D");

    const q24 = esaQuestions(2024);
    expect(q24.find((q) => q.number === 1)?.correctAlternative).toBe("A");
    expect(q24.find((q) => q.number === 15)?.correctAlternative).toBe("B");
    expect(q24.find((q) => q.number === 41)?.correctAlternative).toBe("E");
    expect(q24.find((q) => q.number === 50)?.correctAlternative).toBe("E");

    const q25 = esaQuestions(2025);
    expect(q25.find((q) => q.number === 2)?.correctAlternative).toBe("C");
    expect(q25.find((q) => q.number === 15)?.correctAlternative).toBe("B");
    expect(q25.find((q) => q.number === 41)?.correctAlternative).toBe("A");
    expect(q25.find((q) => q.number === 50)?.correctAlternative).toBe("C");
  });

  it("não finge que o espelho é a URL oficial", () => {
    for (const year of esaYears()) {
      const question = esaQuestions(year)[0];
      expect(question.statementAvailable).toBe(false);
      expect(question.official?.official).toBe(false);
      expect(question.official?.documentUrl).toBe(esaExamUrl(year));
      expect(question.official?.documentUrl).toContain("qconcursos.com");
    }
  });

  it("usa chave estável por ano, fase e número", () => {
    expect(esaQuestionKey(esaQuestions(2025)[0])).toBe("esa-2025-single-1");
    expect(esaQuestionKey(esaQuestions(2024)[0])).toBe("esa-2024-single-1");
    expect(esaQuestionKey(esaQuestions(2023)[0])).toBe("esa-2023-single-1");
  });

  it("provider entrega as edições ingeridas e recusa ano ausente", async () => {
    expect(await esaProvider.fetchQuestions({ year: 2025 })).toHaveLength(50);
    expect(await esaProvider.fetchQuestions({ year: 2024 })).toHaveLength(50);
    expect(await esaProvider.fetchQuestions({ year: 2023 })).toHaveLength(50);
    expect(await esaProvider.fetchQuestions({ year: 2022 })).toEqual([]);
  });
});
