import { describe, expect, it } from "vitest";
import { makeAttempt, makeDB, makeRow } from "./__fixtures__/db";
import { questionKey } from "./classify";
import { buildStudyQueue } from "./study-queue";
import type { Question } from "./types";

function question(index: number, content: string, providerId = "enem"): Question {
  return {
    providerId,
    index,
    year: 2026,
    phase: "first",
    discipline: "matematica",
    correctAlternative: "A",
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

describe("unified study queue", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("puts overdue review first and deduplicates the same question from retry/adaptive", () => {
    const q1 = question(1, "Funções");
    const q2 = question(2, "Probabilidade");
    const key = questionKey(q1);
    const wrong = makeRow({
      key,
      index: q1.index,
      year: q1.year,
      area: "matematica",
      content: "Funções",
      tags: ["Funções"],
      providerId: "enem",
      selected: "B",
      correct: "A",
      isCorrect: false,
      finishedAt: "2026-09-10T12:00:00.000Z",
    });
    const db = makeDB({
      attempts: [makeAttempt({ result: { rows: [wrong], correct: 0, total: 1, blank: 0 } })],
      srs: {
        [key]: {
          providerId: "enem",
          reps: 0,
          interval: 0,
          due: "2026-09-01T12:00:00.000Z",
          year: q1.year,
          index: q1.index,
          area: "matematica",
          content: "Funções",
          language: null,
          lastResult: "wrong",
        },
      },
    });

    const queue = buildStudyQueue(db, [q1, q2], "enem", "balanced", 10, now);
    expect(queue[0].kind).toBe("review");
    expect(queue[0].questionKey).toBe(key);
    expect(queue.filter((item) => item.questionKey === key)).toHaveLength(1);
  });

  it("never leaks questions from another provider and respects the limit", () => {
    const enem = Array.from({ length: 5 }, (_, index) => question(index + 1, `ENEM ${index}`, "enem"));
    const unesp = Array.from({ length: 5 }, (_, index) => question(index + 1, `UNESP ${index}`, "unesp"));
    const queue = buildStudyQueue(makeDB(), [...enem, ...unesp], "unesp", "coverage", 3, now);
    expect(queue).toHaveLength(3);
    expect(queue.every((item) => item.providerId === "unesp")).toBe(true);
    expect(queue.every((item) => item.question.providerId === "unesp")).toBe(true);
  });

  it("is deterministic for a fixed clock", () => {
    const all = Array.from({ length: 10 }, (_, index) => question(index + 1, `Tema ${index % 3}`));
    const first = buildStudyQueue(makeDB(), all, "enem", "gain", 7, now).map((item) => item.questionKey);
    const second = buildStudyQueue(makeDB(), all, "enem", "gain", 7, now).map((item) => item.questionKey);
    expect(second).toEqual(first);
  });
});
