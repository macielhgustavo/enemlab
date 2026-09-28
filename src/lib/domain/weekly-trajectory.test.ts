import { describe, expect, it } from "vitest";
import { makeAttempt, makeDB, makeRow } from "./__fixtures__/db";
import { buildWeeklyTrajectory } from "./weekly-trajectory";
import { setProviderStudyConfig } from "./study-learning";

function attemptAt(
  id: string,
  finishedAt: string,
  total: number,
  mode: "bank" | "srs" = "bank",
  area = "matematica",
) {
  const rows = Array.from({ length: total }, (_, index) =>
    makeRow({
      key: `${id}-${index}`,
      index: index + 1,
      area,
      selected: index % 4 === 0 ? "B" : "A",
      correct: "A",
      isCorrect: index % 4 !== 0,
      content: "Conteúdo de teste",
      tags: ["Conteúdo de teste"],
      finishedAt,
    }),
  );
  return makeAttempt({
    id,
    providerId: "enem",
    mode,
    startedAt: finishedAt,
    finishedAt,
    result: {
      rows,
      correct: rows.filter((row) => row.isCorrect).length,
      total,
      blank: 0,
    },
  });
}

describe("weekly trajectory", () => {
  const now = new Date("2026-09-24T12:00:00.000Z");

  it("compara realizado com o esperado da semana usando as metas existentes", () => {
    const db = makeDB({
      attempts: [
        attemptAt("q", "2026-09-22T12:00:00.000Z", 20),
        attemptAt("r", "2026-09-23T12:00:00.000Z", 8, "srs"),
      ],
      goals: { questions: 70, reviews: 14, essays: 1 },
    });
    setProviderStudyConfig(db, "enem", {
      weeklyQuestions: 70,
      targetDate: "2026-11-08",
    });

    const trajectory = buildWeeklyTrajectory(db, "enem", now);
    expect(trajectory.elapsedWeekDays).toBe(4);
    expect(trajectory.metrics.find((item) => item.key === "questions")).toMatchObject({
      done: 28,
      target: 70,
      expectedByNow: 40,
      pacePct: 70,
    });
    expect(trajectory.metrics.find((item) => item.key === "reviews")).toMatchObject({
      done: 8,
      target: 14,
      expectedByNow: 8,
      pacePct: 100,
    });
    expect(trajectory.daysRemaining).toBeGreaterThan(0);
    expect(trajectory.weeksRemaining).toBeGreaterThan(0);
  });

  it("fica em calibração quando a amostra é pequena", () => {
    const db = makeDB({
      attempts: [attemptAt("tiny", "2026-09-22T12:00:00.000Z", 3)],
    });
    const trajectory = buildWeeklyTrajectory(db, "enem", now);
    expect(trajectory.confidence).toBe("baixa");
    expect(trajectory.rhythm).toBe("calibrating");
    expect(trajectory.reasons.join(" ")).toMatch(/baixa confiança/i);
  });

  it("conta redações independentes sem apagar ou criar histórico", () => {
    const db = makeDB({
      essays: [
        {
          id: "essay-1",
          providerId: "enem",
          themeId: null,
          theme: "Tema",
          themeSource: "project",
          text: "Texto",
          versions: [],
          repertoire: "",
          improvements: "",
          evaluations: [],
          elapsedSec: 1200,
          timeLimitMin: 90,
          startedAt: "2026-09-22T10:00:00.000Z",
          updatedAt: "2026-09-22T11:00:00.000Z",
          finishedAt: "2026-09-22T11:00:00.000Z",
        },
      ],
      goals: { questions: 150, reviews: 30, essays: 2 },
    });

    const trajectory = buildWeeklyTrajectory(db, "enem", now);
    expect(trajectory.metrics.find((item) => item.key === "essays")).toMatchObject({
      done: 1,
      target: 2,
    });
    expect(db.essays).toHaveLength(1);
  });

  it("mantém série por área escopada à prova", () => {
    const db = makeDB({
      attempts: [
        attemptAt("math", "2026-09-22T12:00:00.000Z", 8, "bank", "matematica"),
        makeAttempt({
          id: "ita",
          providerId: "ita",
          startedAt: "2026-09-22T12:00:00.000Z",
          finishedAt: "2026-09-22T12:00:00.000Z",
          result: {
            rows: [
              makeRow({
                providerId: "ita",
                key: "ita-1",
                area: "physics",
                selected: "A",
                correct: "A",
                isCorrect: true,
                finishedAt: "2026-09-22T12:00:00.000Z",
              }),
            ],
            correct: 1,
            total: 1,
            blank: 0,
          },
        }),
      ],
    });

    const trajectory = buildWeeklyTrajectory(db, "enem", now);
    expect(trajectory.areas.find((area) => area.id === "matematica")?.total).toBe(8);
    expect(trajectory.areas.some((area) => area.id === "physics")).toBe(false);
  });
});
