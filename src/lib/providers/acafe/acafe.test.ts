import { describe, expect, it } from "vitest";
import { buildCurrentCatalog } from "@/lib/catalog/current";
import { questionKey } from "@/lib/domain/classify";
import { attemptFromQuestions, questionsForAttempt } from "@/lib/services/attempts";
import { getSource } from "@/lib/sources";
import { toLegacyQuestion } from "../legacy";
import {
  acafeAnswerKey,
  acafeEditions,
  acafeQuestionKey,
  acafeQuestions,
  acafeYears,
} from ".";

describe("ACAFE", () => {
  it("entrega nove edições e 567 questões objetivas", () => {
    expect(acafeEditions()).toHaveLength(9);
    expect(acafeYears()).toEqual([2026, 2025, 2024, 2023, 2022]);
    expect(acafeQuestions("2026.2")).toHaveLength(63);

    const catalog = buildCurrentCatalog();
    expect(catalog.query({ providerId: "acafe" })).toHaveLength(9);
    expect(catalog.countQuestions({ providerId: "acafe" })).toEqual({
      known: 567,
      unknownEditions: 0,
    });
  });

  it("preserva matérias, anuladas e a variante distinta de Espanhol", () => {
    const key = acafeAnswerKey("2024.2")!;
    expect(key.total).toBe(63);
    expect(key.annulled).toContain(56);
    expect(key.variantRelation).toBe("distinct");
    expect(key.variants.map((variant) => variant.id)).toEqual(["ingles", "espanhol"]);
    expect(key.variantAnswerKeys?.espanhol.answers["15"]).toMatch(/^[A-E]$/);
    expect(key.subjects.find((subject) => subject.id === "fisica")?.numbers).toEqual([
      29, 30, 31, 32, 33, 34, 35,
    ]);
  });

  it("gera chaves determinísticas por semestre", () => {
    const current = acafeQuestions("2026.2")[0];
    const previous = acafeQuestions("2026.1")[0];

    expect(acafeQuestionKey(current)).toBe("acafe-2026-2-single-1");
    expect(acafeQuestionKey(previous)).toBe("acafe-2026-1-single-1");
    expect(questionKey(toLegacyQuestion(current))).toBe("acafe-2026-2-single-1");
  });

  it("reconstrói tentativa sem trocar o semestre", async () => {
    const question = toLegacyQuestion(acafeQuestions("2025.1")[0]);
    const attempt = attemptFromQuestions(2025, "ingles", [question], "full", "acafe");
    const rebuilt = await questionsForAttempt(attempt);

    expect(rebuilt.map(questionKey)).toEqual(["acafe-2025-1-single-1"]);
  });

  it("mantém fonte oficial em modo referência", () => {
    const source = getSource("acafe-official-archive");
    expect(source.status).toBe("active");
    expect(source.rightsStatus).toBe("official-reference");
    expect(source.parserVersion).toBe("acafe-answer-key@1.0.0");
  });
});
