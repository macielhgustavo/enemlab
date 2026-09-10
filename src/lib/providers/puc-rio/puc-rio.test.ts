import { describe, expect, it } from "vitest";
import { buildCurrentCatalog } from "@/lib/catalog/current";
import { questionKey } from "@/lib/domain/classify";
import { attemptFromQuestions, questionsForAttempt } from "@/lib/services/attempts";
import { getSource } from "@/lib/sources";
import { pucSpQuestions } from "../puc-sp";
import { toLegacyQuestion } from "../legacy";
import {
  pucRioAnswerKey,
  pucRioQuestionKey,
  pucRioQuestions,
  pucRioYears,
} from ".";

describe("PUC-Rio", () => {
  it("entrega nove edições e 330 referências objetivas", () => {
    expect(pucRioYears()).toEqual([2026, 2025, 2024, 2020, 2019, 2018, 2017, 2016, 2015]);
    expect(pucRioQuestions(2026)).toHaveLength(45);
    expect(pucRioQuestions(2015)).toHaveLength(20);

    const catalog = buildCurrentCatalog();
    expect(catalog.query({ providerId: "puc-rio" })).toHaveLength(9);
    expect(catalog.countQuestions({ providerId: "puc-rio" })).toEqual({
      known: 330,
      unknownEditions: 0,
    });
  });

  it("preserva anuladas e retificações do arquivo oficial", () => {
    expect(pucRioAnswerKey(2025)?.annulled).toEqual([8]);
    expect(pucRioAnswerKey(2020)?.annulled).toEqual([19, 36]);
    expect(pucRioAnswerKey(2020)?.revision).toBe("rectified");
    expect(pucRioAnswerKey(2020)?.answers["22"]).toBe("E");
    expect(pucRioAnswerKey(2020)?.answers["24"]).toBe("D");
  });

  it("gera chaves determinísticas próprias da instituição", () => {
    const question = pucRioQuestions(2025)[0];
    expect(pucRioQuestionKey(question)).toBe("puc-rio-2025-day2-1");
    expect(questionKey(toLegacyQuestion(question))).toBe("puc-rio-2025-day2-1");
    expect(pucSpQuestions(2025)[0].providerId).toBe("puc-sp");
  });

  it("reconstrói tentativas sem misturar PUC-Rio e PUC-SP", async () => {
    const questions = pucRioQuestions(2025).slice(0, 3).map(toLegacyQuestion);
    const attempt = attemptFromQuestions(2025, "ingles", questions, "full", "puc-rio");
    const rebuilt = await questionsForAttempt(attempt);

    expect(attempt.questionRefs.every((reference) => reference.providerId === "puc-rio")).toBe(true);
    expect(rebuilt.map(questionKey)).toEqual([
      "puc-rio-2025-day2-1",
      "puc-rio-2025-day2-2",
      "puc-rio-2025-day2-3",
    ]);
  });

  it("mantém fonte oficial somente por referência", () => {
    const source = getSource("puc-rio-official-repository");
    expect(source).toMatchObject({
      status: "active",
      rightsStatus: "official-reference",
      statementMode: "reference-only",
      parserVersion: "puc-rio-answer-key@1.0.0",
    });
    expect(
      pucRioQuestions(2025).every((question) =>
        question.alternatives.every((alternative) => alternative.text === null),
      ),
    ).toBe(true);
  });
});
