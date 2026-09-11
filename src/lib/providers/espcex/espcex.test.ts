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
    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018]);
    const k18 = espcexAnswerKey(2018)!;
    expect(k18.revision).toBe("mirror-reviewed-2018");
    expect(k18.days.day1.model).toBe("A");
    expect(k18.days.day2.model).toBe("D");
    expect(k18.days.day1.total).toBe(44);
    expect(k18.days.day2.total).toBe(56);
    expect(k18.days.day1.annulled).toEqual([]);
    expect(k18.days.day2.annulled).toEqual([]);

    const k19 = espcexAnswerKey(2019)!;
    expect(k19.revision).toBe("mirror-reviewed-2019");
    expect(k19.days.day1.model).toBe("B");
    expect(k19.days.day2.model).toBe("D");
    expect(k19.days.day1.total).toBe(44);
    expect(k19.days.day2.total).toBe(56);
    expect(k19.days.day1.annulled).toEqual([]);
    expect(k19.days.day2.annulled).toEqual([]);

    const k20 = espcexAnswerKey(2020)!;
    expect(k20.revision).toBe("definitive-2020");
    expect(k20.days.day1.model).toBe("A");
    expect(k20.days.day2.model).toBe("D");
    expect(k20.days.day1.total).toBe(44);
    expect(k20.days.day2.total).toBe(56);
    expect(k20.days.day2.annulled).toEqual([39]);

    const k21 = espcexAnswerKey(2021)!;
    expect(k21.revision).toBe("final-mirror-2021");
    expect(k21.days.day1.model).toBe("A");
    expect(k21.days.day2.model).toBe("D");
    expect(k21.days.day1.total).toBe(44);
    expect(k21.days.day2.total).toBe(56);
    expect(k21.days.day1.annulled).toEqual([39]);

    const k22 = espcexAnswerKey(2022)!;
    expect(k22.revision).toBe("definitive-2022");
    expect(k22.days.day1.model).toBe("A");
    expect(k22.days.day2.model).toBe("D");
    expect(k22.days.day1.total).toBe(44);
    expect(k22.days.day2.total).toBe(56);
    expect(k22.days.day2.annulled).toEqual([17]);

    const k23 = espcexAnswerKey(2023)!;
    expect(k23.revision).toBe("final-2023-10-16");
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
    const q20 = espcexQuestions(2020).find((q) => q.phase === "day2" && q.number === 39)!;
    expect(q20.correctAlternative).toBeNull();
    expect(q20.alternatives.every((a) => !a.isCorrect)).toBe(true);
    const q21 = espcexQuestions(2021).find((q) => q.phase === "day1" && q.number === 39)!;
    expect(q21.correctAlternative).toBeNull();
    expect(q21.alternatives.every((a) => !a.isCorrect)).toBe(true);
    const q22 = espcexQuestions(2022).find((q) => q.phase === "day2" && q.number === 17)!;
    expect(q22.correctAlternative).toBeNull();
    expect(q22.alternatives.every((a) => !a.isCorrect)).toBe(true);
    const q23 = espcexQuestions(2023).find((q) => q.phase === "day2" && q.number === 27)!;
    expect(q23.correctAlternative).toBeNull();
    expect(q23.alternatives.every((a) => !a.isCorrect)).toBe(true);
    const q24 = espcexQuestions(2024).find((q) => q.phase === "day2" && q.number === 42)!;
    expect(q24.correctAlternative).toBeNull();
    expect(q24.alternatives.every((a) => !a.isCorrect)).toBe(true);
    const q25 = espcexQuestions(2025).find((q) => q.phase === "day1" && q.number === 2)!;
    expect(q25.correctAlternative).toBeNull();
  });

  it("não chama caderno espelhado de oficial", () => {
    const q18 = espcexQuestions(2018)[0];
    expect(q18.statementAvailable).toBe(false);
    expect(q18.official?.official).toBe(false);
    expect(q18.official?.documentUrl).toContain("hdocurso.com.br");

    const q19 = espcexQuestions(2019)[0];
    expect(q19.statementAvailable).toBe(false);
    expect(q19.official?.official).toBe(false);
    expect(q19.official?.documentUrl).toContain("hdocurso.com.br");

    const q20 = espcexQuestions(2020)[0];
    expect(q20.statementAvailable).toBe(false);
    expect(q20.official?.official).toBe(false);
    expect(q20.official?.documentUrl).toContain("hdocurso.com.br");

    const q21 = espcexQuestions(2021)[0];
    expect(q21.statementAvailable).toBe(false);
    expect(q21.official?.official).toBe(false);
    expect(q21.official?.documentUrl).toContain("hdocurso.com.br");

    const q22 = espcexQuestions(2022)[0];
    expect(q22.statementAvailable).toBe(false);
    expect(q22.official?.official).toBe(false);
    expect(q22.official?.documentUrl).toContain("hdocurso.com.br");

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
    expect(espcexQuestionKey(espcexQuestions(2022)[0])).toBe("espcex-2022-day1-1");
    expect(espcexQuestionKey(espcexQuestions(2021)[0])).toBe("espcex-2021-day1-1");
    expect(espcexQuestionKey(espcexQuestions(2020)[0])).toBe("espcex-2020-day1-1");
    expect(espcexQuestionKey(espcexQuestions(2019)[0])).toBe("espcex-2019-day1-1");
    expect(espcexQuestionKey(espcexQuestions(2018)[0])).toBe("espcex-2018-day1-1");
  });

  it("provider entrega as edições completas e recusa ano ausente", async () => {
    expect(await espcexProvider.fetchQuestions({ year: 2025 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2024 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2023 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2022 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2021 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2020 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2019 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2018 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2017 })).toEqual([]);
  });
});
