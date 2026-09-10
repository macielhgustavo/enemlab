import { describe, expect, it } from "vitest";
import { buildCurrentCatalog } from "@/lib/catalog/current";
import { questionKey } from "@/lib/domain/classify";
import { attemptFromQuestions, questionsForAttempt } from "@/lib/services/attempts";
import { getSource } from "@/lib/sources";
import { toLegacyQuestion } from "../legacy";
import {
  udescAnswerKeys,
  udescEditions,
  udescQuestionKey,
  udescQuestions,
  udescYears,
} from ".";

describe("UDESC", () => {
  it("entrega 18 edições e 1.800 questões em duas sessões", () => {
    expect(udescEditions()).toHaveLength(18);
    expect(udescYears()).toEqual([2026, 2025, 2024, 2023, 2020, 2019, 2018, 2017, 2016, 2015]);
    expect(udescQuestions("2026.2")).toHaveLength(100);

    const catalog = buildCurrentCatalog();
    expect(catalog.query({ providerId: "udesc" })).toHaveLength(36);
    expect(catalog.countQuestions({ providerId: "udesc" })).toEqual({
      known: 1800,
      unknownEditions: 0,
    });
  });

  it("preserva sessões, matérias e anuladas do gabarito oficial", () => {
    const [morning, afternoon] = udescAnswerKeys("2026.2");
    expect(morning.phase).toBe("morning");
    expect(morning.annulled).toEqual([9]);
    expect(morning.variantRelation).toBe("distinct");
    expect(morning.variants.map((variant) => variant.id)).toEqual(["ingles", "espanhol"]);
    expect(morning.variantAnswerKeys?.espanhol.answers["29"]).toMatch(/^[A-E]$/);
    expect(
      Object.keys(morning.variantAnswerKeys?.espanhol.answers ?? {}).length
        + (morning.variantAnswerKeys?.espanhol.annulled.length ?? 0),
    ).toBe(50);
    expect(morning.subjects.find((subject) => subject.id === "ingles")?.numbers).toEqual([
      29, 30, 31, 32, 33, 34, 35, 36,
    ]);
    expect(afternoon.phase).toBe("afternoon");
    expect(afternoon.annulled).toEqual([14]);
    expect(afternoon.subjects.find((subject) => subject.id === "filosofia")?.numbers).toEqual([38, 39]);
    expect(afternoon.subjects.find((subject) => subject.id === "sociologia")?.numbers).toEqual([49, 50]);
  });

  it("gera chaves diferentes por edição e sessão", () => {
    const current = udescQuestions("2026.2");
    const previous = udescQuestions("2026.1");
    const morning = current.find((question) => question.phase === "morning" && question.number === 1)!;
    const afternoon = current.find((question) => question.phase === "afternoon" && question.number === 1)!;

    expect(udescQuestionKey(morning)).toBe("udesc-2026-2-morning-1");
    expect(udescQuestionKey(afternoon)).toBe("udesc-2026-2-afternoon-1");
    expect(udescQuestionKey(previous[0])).toBe("udesc-2026-1-morning-1");
    expect(questionKey(toLegacyQuestion(morning))).toBe("udesc-2026-2-morning-1");
  });

  it("reconstrói a tentativa pela chave exata sem trocar manhã por tarde", async () => {
    const questions = udescQuestions("2026.2")
      .filter((question) => question.number === 1)
      .map(toLegacyQuestion);
    const attempt = attemptFromQuestions(2026, "ingles", questions, "full", "udesc");
    const rebuilt = await questionsForAttempt(attempt);

    expect(rebuilt.map(questionKey)).toEqual([
      "udesc-2026-2-morning-1",
      "udesc-2026-2-afternoon-1",
    ]);
  });

  it("mantém fonte oficial em modo referência", () => {
    const source = getSource("udesc-official-archive");
    expect(source.status).toBe("active");
    expect(source.rightsStatus).toBe("official-reference");
    expect(source.parserVersion).toBe("udesc-answer-key@1.0.0");
  });
});
