import { describe, expect, it } from "vitest";
import {
  espcexAnswerKey,
  espcexExamUrl,
  espcexProvider,
  espcexQuestionKey,
  espcexQuestions,
  espcexYears,
} from ".";

describe("EsPCEx 2025", () => {
  it("publica apenas edições completas e revisadas", () => {
    expect(espcexYears()).toEqual([2025]);
    const key = espcexAnswerKey(2025)!;
    expect(key.revision).toBe("final-2025-10-13");
    expect(key.days.day1.total).toBe(44);
    expect(key.days.day2.total).toBe(56);
  });

  it("gera os dois dias sem misturar numeração", () => {
    const questions = espcexQuestions(2025);
    expect(questions).toHaveLength(100);
    expect(questions.filter((q) => q.phase === "day1")).toHaveLength(44);
    expect(questions.filter((q) => q.phase === "day2")).toHaveLength(56);
    expect(questions.find((q) => q.phase === "day1" && q.number === 44)?.subject.id).toBe("chemistry");
    expect(questions.find((q) => q.phase === "day2" && q.number === 45)?.subject.id).toBe("english");
  });

  it("preserva a anulada do primeiro dia", () => {
    const q2 = espcexQuestions(2025).find((q) => q.phase === "day1" && q.number === 2)!;
    expect(q2.correctAlternative).toBeNull();
    expect(q2.alternatives.every((a) => !a.isCorrect)).toBe(true);
  });

  it("mantém procedência oficial e modo referência", () => {
    const q = espcexQuestions(2025)[0];
    expect(q.statementAvailable).toBe(false);
    expect(q.official?.official).toBe(true);
    expect(q.official?.documentUrl).toBe(espcexExamUrl(2025, "day1"));
    expect(q.official?.documentUrl).toContain("espcex.eb.mil.br");
  });

  it("usa chave estável por ano, dia e número", () => {
    const [q] = espcexQuestions(2025);
    expect(espcexQuestionKey(q)).toBe("espcex-2025-day1-1");
  });

  it("provider entrega a edição e recusa ano ausente", async () => {
    expect(await espcexProvider.fetchQuestions({ year: 2025 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2024 })).toEqual([]);
  });
});
