import { describe, expect, it } from "vitest";
import {
  espcexAnswerKey,
  espcexExamUrl,
  espcexProvider,
  espcexQuestionKey,
  espcexQuestions,
  espcexYears,
} from ".";

describe("EsPCEx", () => {
  it("publica apenas edições completas e revisadas", () => {
    expect(espcexYears()).toEqual([2025, 2024, 2023]);
    const k23 = espcexAnswerKey(2023)!;
    expect(k23.revision).toBe("mirror-reviewed-2023");
    expect(k23.days.day1.model).toBe("A");
    expect(k23.days.day2.model).toBe("D");
    expect(k23.days.day1.total).toBe(44);
    expect(k23.days.day2.total).toBe(56);

    const k24 = espcexAnswerKey(2024)!;
    expect(k24.revision).toBe("final-2024-10-21");
    expect(k24.days.day1.model).toBe("A");
    expect(k24.days.day2.model).toBe("D");
    expect(k24.days.day1.total).toBe(44);
    expect(k24.days.day2.total).toBe(56);
    expect(k24.days.day2.annulled).toEqual([42]);

    const k25 = espcexAnswerKey(2025)!;
    expect(k25.revision).toBe("final-2025-10-13");
    expect(k25.days.day1.total).toBe(44);
    expect(k25.days.day2.total).toBe(56);
  });

  it("cada dia cobre exatamente a numeração declarada", () => {
    for (const year of espcexYears()) {
      const key = espcexAnswerKey(year)!;
      for (const day of [key.days.day1, key.days.day2]) {
        const covered = [...Object.keys(day.answers).map(Number), ...day.annulled].sort((a, b) => a - b);
        expect(covered).toEqual(Array.from({ length: day.total }, (_, i) => i + 1));
        expect(new Set(covered).size).toBe(day.total);
        expect(Object.values(day.answers).every((answer) => /^[A-E]$/.test(answer))).toBe(true);
      }
    }
  });

  it("gera os dois dias sem misturar numeração", () => {
    for (const year of espcexYears()) {
      const questions = espcexQuestions(year);
      expect(questions).toHaveLength(100);
      expect(questions.filter((q) => q.phase === "day1")).toHaveLength(44);
      expect(questions.filter((q) => q.phase === "day2")).toHaveLength(56);
      expect(questions.find((q) => q.phase === "day1" && q.number === 44)?.subject.id).toBe("chemistry");
      expect(questions.find((q) => q.phase === "day2" && q.number === 45)?.subject.id).toBe("english");
    }
  });

  it("preserva anuladas sem marcar alternativa correta", () => {
    const q24 = espcexQuestions(2024).find((q) => q.phase === "day2" && q.number === 42)!;
    expect(q24.correctAlternative).toBeNull();
    expect(q24.alternatives.every((a) => !a.isCorrect)).toBe(true);
    const q25 = espcexQuestions(2025).find((q) => q.phase === "day1" && q.number === 2)!;
    expect(q25.correctAlternative).toBeNull();
  });

  it("não chama caderno espelhado de oficial", () => {
    const q23 = espcexQuestions(2023)[0];
    expect(q23.statementAvailable).toBe(false);
    expect(q23.official?.official).toBe(false);
    expect(q23.official?.documentUrl).toContain("hdocurso.com.br");

    const q24 = espcexQuestions(2024)[0];
    expect(q24.statementAvailable).toBe(false);
    expect(q24.official?.official).toBe(false);
    expect(q24.official?.documentUrl).toBe(espcexExamUrl(2024, "day1"));
    expect(q24.official?.documentUrl).toContain("onlineespecifico.com.br");

    const q25 = espcexQuestions(2025)[0];
    expect(q25.official?.official).toBe(true);
    expect(q25.official?.documentUrl).toContain("espcex.eb.mil.br");
  });

  it("usa chave estável por ano, dia e número", () => {
    expect(espcexQuestionKey(espcexQuestions(2025)[0])).toBe("espcex-2025-day1-1");
    expect(espcexQuestionKey(espcexQuestions(2024)[0])).toBe("espcex-2024-day1-1");
    expect(espcexQuestionKey(espcexQuestions(2023)[0])).toBe("espcex-2023-day1-1");
  });

  it("provider entrega as edições completas e recusa ano ausente", async () => {
    expect(await espcexProvider.fetchQuestions({ year: 2025 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2024 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2023 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2022 })).toEqual([]);
  });
});
