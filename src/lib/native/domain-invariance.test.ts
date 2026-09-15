import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adaptiveCandidates, buildAdaptiveQuestions } from "../domain/adaptive";
import { classifyContent, questionKey } from "../domain/classify";
import { makeDB } from "../domain/__fixtures__/db";
import { allSrs } from "../domain/srs";
import { masteryStats } from "../domain/stats";
import type { Question } from "../domain/types";
import { attemptFromQuestions, finishAttemptInDB } from "../services/attempts";
import type { NativePack } from "./contracts";
import { applyNativePackToQuestions } from "./loader";

function providerQuestion(index = 1, context = "Em uma urna, qual é a probabilidade de retirar a bola indicada?"): Question {
  return {
    providerId: "fatec",
    editionId: "2026.1",
    phase: "single",
    year: 2026,
    index,
    number: index,
    discipline: "matematica",
    context,
    alternativesIntroduction: "Assinale a alternativa correta.",
    alternatives: ["A", "B", "C", "D", "E"].map((letter) => ({
      letter,
      text: `Alternativa ${letter}`,
      isCorrect: letter === "C",
    })),
    correctAlternative: "C",
    files: [],
    statementAvailable: true,
  };
}

function publishedPack(question: Question): NativePack {
  const key = questionKey(question);
  return {
    version: 1,
    createdAt: "2026-09-14T20:00:00.000Z",
    documents: [
      {
        documentId: "fatec-2026-1-single",
        providerId: "fatec",
        year: 2026,
        editionId: "2026.1",
        phase: "single",
        sourceUrl: "https://example.com/fatec.pdf",
        sourceSha256: "a".repeat(64),
        sourceBytes: 1000,
        pageCount: 20,
        pageAssetPattern: "native/fatec/2026.1/single/aaaaaaaaaaaaaaaa/pages/page-{page:03d}.webp",
        renderScale: 1.5,
        imageFormat: "webp",
      },
    ],
    questions: [
      {
        questionKey: key,
        providerId: "fatec",
        year: 2026,
        editionId: "2026.1",
        phase: "single",
        number: question.number ?? question.index,
        documentId: "fatec-2026-1-single",
        visualRegions: [
          {
            page: 2,
            role: "question",
            rect: { x: 0.05, y: 0.1, width: 0.9, height: 0.3 },
            assetPath: "native/fatec/questions/q-001-r0.webp",
          },
        ],
        semantic: { rawText: "conteúdo semântico não usado para corrigir" },
        extraction: {
          method: "text-layer",
          parserVersion: "native-pipeline@2.0.0",
          confidence: 1,
          markerDetected: true,
          optionIdsDetected: ["A", "B", "C", "D", "E"],
          issues: [],
          visualCompleteness: {
            required: false,
            resolved: true,
            reasons: [],
            strategy: "not-required",
          },
        },
        status: "published",
      },
    ],
  };
}

function correctedDb(question: Question) {
  const db = makeDB({ activeProvider: "fatec" });
  const attempt = attemptFromQuestions(2026, "ingles", [question], "bank", "fatec");
  attempt.id = "attempt-native-invariance";
  const key = questionKey(question);
  attempt.answers[key] = "A";
  attempt.confidence[key] = "certeza";
  attempt.timeQ[key] = 210;
  attempt.flags[key] = true;
  db.attempts.push(attempt);
  finishAttemptInDB(db, attempt.id, [question]);
  return db;
}

describe("NativePack domain invariance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T20:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserva classificação, gabarito, mastery, erros, SRS e fila adaptativa", () => {
    const reference = providerQuestion();
    const pack = publishedPack(reference);
    const path = pack.questions[0].visualRegions[0].assetPath!;
    const native = applyNativePackToQuestions(
      [reference],
      pack,
      new Map([[path, "https://signed.example.com/fatec-q1.webp"]]),
    )[0];

    expect(native).not.toBe(reference);
    expect(native.context).toBeUndefined();
    expect(native.alternatives?.every((alternative) => alternative.text === "")).toBe(true);
    expect(native.correctAlternative).toBe(reference.correctAlternative);
    expect(native.alternatives?.find((alternative) => alternative.isCorrect)?.letter).toBe("C");
    expect(questionKey(native)).toBe(questionKey(reference));
    expect(classifyContent(reference)).toBe("Probabilidade");
    expect(classifyContent(native)).toBe(classifyContent(reference));

    const referenceDb = correctedDb(reference);
    const nativeDb = correctedDb(native);

    expect(nativeDb.attempts[0].result).toEqual(referenceDb.attempts[0].result);
    expect(allSrs(nativeDb, "fatec")).toEqual(allSrs(referenceDb, "fatec"));
    expect(masteryStats(nativeDb, "fatec")).toEqual(masteryStats(referenceDb, "fatec"));
    expect(adaptiveCandidates(nativeDb, "fatec")).toEqual(adaptiveCandidates(referenceDb, "fatec"));
    expect(nativeDb.sessions).toEqual(referenceDb.sessions);

    const pool = [
      providerQuestion(1),
      providerQuestion(2, "Um triângulo retângulo satisfaz o teorema de Pitágoras."),
      providerQuestion(3, "Uma função quadrática é representada pelo gráfico descrito."),
    ];
    expect(buildAdaptiveQuestions(nativeDb, pool, 3, "fatec").map(questionKey)).toEqual(
      buildAdaptiveQuestions(referenceDb, pool, 3, "fatec").map(questionKey),
    );
  });
});
