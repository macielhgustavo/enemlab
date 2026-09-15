import { describe, expect, it } from "vitest";
import { makeAttempt, makeDB, makeRow } from "./__fixtures__/db";
import { buildAdaptiveSelection } from "./adaptive";
import { buildObjectiveAdaptiveSelection } from "./adaptive-objectives";
import { questionKey } from "./classify";
import type { Question } from "./types";

function question(index: number, content: string): Question {
  return {
    index,
    year: 2023,
    discipline: "matematica",
    context: `Questão de ${content}`,
    correctAlternative: "A",
    alternatives: [{ letter: "A", text: "A" }, { letter: "B", text: "B" }],
    classificationSnapshot: {
      primary: content,
      tags: [content],
      path: [content],
      subtopic: null,
      confidence: "alta",
      score: 10,
      margin: 5,
      evidence: ["fixture"],
    },
  };
}

function historyFor(q: Question, content: string, count: number, correct = false) {
  const key = questionKey(q);
  const rows = Array.from({ length: count }, (_, index) =>
    makeRow({
      key,
      index: q.index,
      year: q.year,
      area: "matematica",
      content,
      tags: [content],
      isCorrect: correct,
      selected: correct ? "A" : "B",
      correct: "A",
      finishedAt: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    }),
  );
  return makeAttempt({
    id: `a-${q.index}`,
    result: { rows, correct: correct ? count : 0, total: count, blank: 0 },
  });
}

describe("adaptive objectives", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("keeps balanced mode exactly aligned with the historical adaptive queue", () => {
    const all = [question(1, "Funções"), question(2, "Probabilidade"), question(3, "Geometria")];
    const db = makeDB();
    const historical = buildAdaptiveSelection(db, all, 3, "enem", now).map((item) => item.decision.key);
    const objective = buildObjectiveAdaptiveSelection(db, all, 3, "enem", "balanced", now).map((item) => item.decision.key);
    expect(objective).toEqual(historical);
  });

  it("recovery favors confirmed weakness while coverage favors sparse unseen content", () => {
    const weak = question(1, "Funções");
    const sparse = question(2, "Estatística");
    const db = makeDB({ attempts: [historyFor(weak, "Funções", 8, false)] });

    const recovery = buildObjectiveAdaptiveSelection(db, [weak, sparse], 2, "enem", "recovery", now);
    const coverage = buildObjectiveAdaptiveSelection(db, [weak, sparse], 2, "enem", "coverage", now);

    expect(recovery[0].question.index).toBe(1);
    expect(coverage[0].question.index).toBe(2);
    expect(recovery[0].decision.objective).toBe("recovery");
    expect(coverage[0].decision.objective).toBe("coverage");
  });

  it("is deterministic for the same state, objective and clock", () => {
    const all = Array.from({ length: 12 }, (_, index) => question(index + 1, `Conteúdo ${index % 4}`));
    const first = buildObjectiveAdaptiveSelection(makeDB(), all, 8, "enem", "gain", now).map((item) => item.decision.key);
    const second = buildObjectiveAdaptiveSelection(makeDB(), all, 8, "enem", "gain", now).map((item) => item.decision.key);
    expect(second).toEqual(first);
  });
});
