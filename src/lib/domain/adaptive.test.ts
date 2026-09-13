import { describe, expect, it } from "vitest";
import { buildAdaptiveQuestions, adaptiveCandidates } from "./adaptive";
import { classifyContent, questionKey } from "./classify";
import { makeAttempt, makeDB, makeRow } from "./__fixtures__/db";
import type { Question } from "./types";
import { toLegacyQuestion, unespFirstPhaseQuestions } from "../providers";

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

    const first = buildAdaptiveQuestions(db, pool, 5, "enem").map(questionKey);
    const second = buildAdaptiveQuestions(db, pool, 5, "enem").map(questionKey);
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
});
