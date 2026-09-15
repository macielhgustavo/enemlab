import { describe, expect, it } from "vitest";
import { makeAttempt, makeDB, makeRow } from "./__fixtures__/db";
import { studyGoalProgress } from "./study-goal";

function attemptWithRows(count: number, finishedAt: string) {
  const rows = Array.from({ length: count }, (_, index) =>
    makeRow({
      key: `goal-${index}`,
      index: index + 1,
      content: index % 2 ? "Funções" : "Probabilidade",
      tags: [index % 2 ? "Funções" : "Probabilidade"],
      selected: index % 4 === 0 ? "B" : "A",
      correct: "A",
      isCorrect: index % 4 !== 0,
      finishedAt,
    }),
  );
  return makeAttempt({
    id: `goal-${count}`,
    startedAt: finishedAt,
    finishedAt,
    result: { rows, correct: rows.filter((row) => row.isCorrect).length, total: rows.length, blank: 0 },
  });
}

describe("study goal progress", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("tracks weekly pace and exact days remaining without predicting admission", () => {
    const db = makeDB({ attempts: [attemptWithRows(14, "2026-09-12T12:00:00.000Z")] });
    const progress = studyGoalProgress(
      db,
      {
        providerId: "enem",
        targetDate: "2026-09-24T00:00:00.000Z",
        weeklyQuestions: 28,
        targetReadiness: 70,
        targetCoverage: 80,
      },
      ["Funções", "Probabilidade", "Geometria"],
      now,
    );
    expect(progress.daysRemaining).toBe(10);
    expect(progress.weeklyQuestionsDone).toBe(14);
    expect(progress.weeklyPacePct).toBe(50);
    expect(progress.readiness.note).toMatch(/não é nota prevista/i);
    expect(progress.coveragePct).not.toBeNull();
  });

  it("refuses to invent a coverage gap when the denominator is unknown", () => {
    const db = makeDB({ attempts: [attemptWithRows(8, "2026-09-12T12:00:00.000Z")] });
    const progress = studyGoalProgress(
      db,
      { providerId: "enem", targetCoverage: 80, weeklyQuestions: 8 },
      undefined,
      now,
    );
    expect(progress.coveragePct).toBeNull();
    expect(progress.coverageGap).toBeNull();
    expect(progress.reasons.join(" ")).toMatch(/denominador explícito/i);
  });

  it("stays calibrating while readiness evidence is low", () => {
    const db = makeDB({ attempts: [attemptWithRows(3, "2026-09-12T12:00:00.000Z")] });
    const progress = studyGoalProgress(
      db,
      { providerId: "enem", weeklyQuestions: 3, targetReadiness: 60 },
      ["Funções", "Probabilidade"],
      now,
    );
    expect(progress.readiness.confidence).toBe("baixa");
    expect(progress.status).toBe("calibrating");
  });
});
