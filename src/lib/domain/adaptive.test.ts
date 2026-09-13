import { describe, expect, it } from "vitest";
import { adaptiveCandidates, adaptiveScoreQuestion } from "./adaptive";
import { makeAttempt, makeDB, makeRow } from "./__fixtures__/db";
import type { Question } from "./types";

const question: Question = {
  providerId: "enem",
  index: 1,
  year: 2023,
  discipline: "matematica",
  context: "Uma questão de porcentagem.",
  alternatives: [
    { letter: "A", text: "10%" },
    { letter: "B", text: "20%" },
    { letter: "C", text: "30%" },
    { letter: "D", text: "40%" },
    { letter: "E", text: "50%" },
  ],
  correctAlternative: "A",
};

describe("adaptive engine", () => {
  it("scores identical state deterministically", () => {
    const db = makeDB();
    const stats = { "Porcentagem e juros": { c: 2, t: 5 } };
    const seen = new Set<string>();

    const first = adaptiveScoreQuestion(db, question, stats, seen);
    const second = adaptiveScoreQuestion(db, question, stats, seen);

    expect(second).toBe(first);
  });

  it("builds the retry queue only from the requested provider", () => {
    const enemAttempt = makeAttempt({
      id: "enem-attempt",
      providerId: "enem",
      result: {
        rows: [
          makeRow({
            key: "enem:2023:1",
            providerId: "enem",
            isCorrect: false,
            selected: "B",
            correct: "A",
            content: "Porcentagem e juros",
          }),
        ],
        correct: 0,
        total: 1,
        blank: 0,
      },
    });
    const otherAttempt = makeAttempt({
      id: "other-attempt",
      providerId: "ita",
      year: 2026,
      result: {
        rows: [
          makeRow({
            key: "ita:2026:1",
            providerId: "ita",
            year: 2026,
            isCorrect: false,
            selected: "C",
            correct: "D",
            content: "mathematics",
          }),
        ],
        correct: 0,
        total: 1,
        blank: 0,
      },
    });
    const db = makeDB({ attempts: [enemAttempt, otherAttempt] });

    expect(adaptiveCandidates(db, "enem").map((item) => item.attemptId)).toEqual([
      "enem-attempt",
    ]);
    expect(adaptiveCandidates(db, "ita").map((item) => item.attemptId)).toEqual([
      "other-attempt",
    ]);
  });
});
