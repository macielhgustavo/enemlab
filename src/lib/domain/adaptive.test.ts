import { describe, expect, it } from "vitest";
import {
  adaptiveCandidates,
  adaptiveDecision,
  adaptiveScoreQuestion,
  buildAdaptiveQuestions,
  buildAdaptiveSelection,
} from "./adaptive";
import { classifyContent, questionKey } from "./classify";
import { makeAttempt, makeDB, makeRow } from "./__fixtures__/db";
import type { Question } from "./types";
import { unespFirstPhaseQuestions } from "../providers";
import { toLegacyQuestion } from "../providers/legacy";

function q(index: number, context: string): Question {
  return {
    providerId: "enem",
    index,
    year: 2023,
    language: null,
    discipline: "matematica",
    context,
    alternatives: [
      { letter: "A", text: "A" },
      { letter: "B", text: "B" },
    ],
    correctAlternative: "A",
  };
}

describe("fila adaptativa determinística", () => {
  it("a mesma entrada produz a mesma ordem", () => {
    const db = makeDB();
    const pool = [
      q(1, "probabilidade em um sorteio"),
      q(2, "função quadrática"),
      q(3, "geometria de um triângulo"),
      q(4, "juros compostos e porcentagem"),
      q(5, "mediana e desvio padrão"),
      q(6, "seno e cosseno"),
      q(7, "progressão aritmética"),
    ];
    const now = new Date("2026-09-14T12:00:00.000Z");

    const first = buildAdaptiveQuestions(db, pool, 5, "enem", now).map(questionKey);
    const second = buildAdaptiveQuestions(db, pool, 5, "enem", now).map(questionKey);
    expect(second).toEqual(first);
  });

  it("UNESP reference-only usa o mapa acadêmico revisado, não uma disciplina genérica", () => {
    const pool = unespFirstPhaseQuestions(2026).map(toLegacyQuestion);
    expect(pool.every((question) => question.statementAvailable === false)).toBe(true);

    const contents = new Set(pool.map(classifyContent));
    expect(contents.size).toBeGreaterThan(5);
    expect(contents.has("conhecimentos-gerais")).toBe(false);

    const chosen = buildAdaptiveQuestions(makeDB(), pool, 15, "unesp");
    const counts = chosen.reduce<Record<string, number>>((acc, question) => {
      const content = classifyContent(question);
      acc[content] = (acc[content] || 0) + 1;
      return acc;
    }, {});
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(5);
  });
});

describe("decisão adaptativa explicável", () => {
  it("expõe componentes cuja soma é exatamente o score usado pelo motor", () => {
    const question = q(1, "probabilidade em um sorteio");
    const key = questionKey(question);
    const content = classifyContent(question);
    const now = new Date("2026-09-14T12:00:00.000Z");
    const db = makeDB({
      srs: {
        [key]: {
          reps: 1,
          interval: 1,
          due: "2026-09-13T12:00:00.000Z",
          year: 2023,
          index: 1,
          area: "matematica",
        },
      },
    });
    const stats = { [content]: { c: 1, t: 4 } };
    const decision = adaptiveDecision(db, question, stats, new Set(), now);
    const componentSum = Object.values(decision.components).reduce((sum, value) => sum + value, 0);

    expect(decision.score).toBe(componentSum);
    expect(adaptiveScoreQuestion(db, question, stats, new Set(), now)).toBe(decision.score);
    expect(decision.overdue).toBe(true);
    expect(decision.components.overdueReview).toBe(34);
    expect(decision.components.novelty).toBe(10);
    expect(decision.reasons.some((reason) => reason.includes("Revisão vencida"))).toBe(true);
  });

  it("usa um relógio injetado e penaliza questão vista há menos de três dias", () => {
    const question = q(2, "função quadrática");
    const key = questionKey(question);
    const content = classifyContent(question);
    const row = makeRow({
      key,
      providerId: "enem",
      index: 2,
      content,
      finishedAt: "2026-09-13T12:00:00.000Z",
    });
    const db = makeDB({
      attempts: [
        makeAttempt({
          providerId: "enem",
          finishedAt: "2026-09-13T12:00:00.000Z",
          result: { rows: [row], correct: 1, total: 1, blank: 0 },
        }),
      ],
    });
    const now = new Date("2026-09-14T12:00:00.000Z");
    const decision = adaptiveDecision(db, question, { [content]: { c: 1, t: 1 } }, new Set([key]), now);

    expect(decision.daysSinceQuestion).toBe(1);
    expect(decision.components.novelty).toBe(-10);
    expect(decision.components.spacing).toBe(-15);
    expect(decision.reasons.some((reason) => reason.includes("Vista recentemente"))).toBe(true);
  });

  it("a seleção explicada preserva a mesma fila pública", () => {
    const db = makeDB();
    const pool = [
      q(1, "probabilidade em um sorteio"),
      q(2, "função quadrática"),
      q(3, "geometria de um triângulo"),
      q(4, "juros compostos e porcentagem"),
      q(5, "mediana e desvio padrão"),
    ];
    const now = new Date("2026-09-14T12:00:00.000Z");

    const explained = buildAdaptiveSelection(db, pool, 4, "enem", now);
    const publicQueue = buildAdaptiveQuestions(db, pool, 4, "enem", now);

    expect(explained.map((item) => questionKey(item.question))).toEqual(publicQueue.map(questionKey));
    expect(explained.every((item) => item.decision.reasons.length > 0)).toBe(true);
  });
});

describe("candidatos por prova", () => {
  it("não mistura erros de ENEM e ITA", () => {
    const enem = makeAttempt({
      id: "enem-attempt",
      providerId: "enem",
      result: {
        rows: [makeRow({ key: "enem-1", providerId: "enem", isCorrect: false })],
        correct: 0,
        total: 1,
        blank: 0,
      },
    });
    const ita = makeAttempt({
      id: "ita-attempt",
      providerId: "ita",
      result: {
        rows: [makeRow({ key: "ita-2026-first-1", providerId: "ita", isCorrect: false })],
        correct: 0,
        total: 1,
        blank: 0,
      },
    });
    const db = makeDB({ attempts: [enem, ita] });

    expect(adaptiveCandidates(db, "enem").map((item) => item.key)).toEqual(["enem-1"]);
    expect(adaptiveCandidates(db, "ita").map((item) => item.key)).toEqual(["ita-2026-first-1"]);
  });

  it("explica por que um erro sobe na fila de retry", () => {
    const row = makeRow({
      key: "enem-1",
      providerId: "enem",
      isCorrect: false,
      confidence: "certeza",
      timeSec: 220,
      content: "Porcentagem e juros",
      attemptId: "enem-attempt",
    });
    const db = makeDB({
      attempts: [
        makeAttempt({
          id: "enem-attempt",
          providerId: "enem",
          result: { rows: [row], correct: 0, total: 1, blank: 0 },
        }),
      ],
      notes: {
        "enem-attempt|enem-1": { reason: "Conteúdo" },
      },
    });

    const candidate = adaptiveCandidates(db, "enem")[0];
    expect(candidate.components.confidence).toBe(25);
    expect(candidate.components.slow).toBe(8);
    expect(candidate.components.diagnosedReason).toBe(12);
    expect(candidate.score).toBe(Object.values(candidate.components).reduce((sum, value) => sum + value, 0));
    expect(candidate.reasons.some((reason) => reason.includes("falsa confiança"))).toBe(true);
    expect(candidate.reasons.some((reason) => reason.includes("erro de conteúdo"))).toBe(true);
  });
});
