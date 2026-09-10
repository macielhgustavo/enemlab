import { describe, expect, it } from "vitest";
import { classifyContent } from "../domain/classify";
import { makeAttempt, makeDB, makeRow } from "../domain/__fixtures__/db";
import type { Question, StudentAIAssistanceTrace } from "../domain/types";
import { buildStudentSnapshot } from "./context";

function highAssistanceTrace(): StudentAIAssistanceTrace {
  return {
    requests: 2,
    maxLevel: 6,
    answerRevealed: true,
    modes: ["hint", "chat"],
    firstAt: "2026-09-10T01:00:00.000Z",
    lastAt: "2026-09-10T01:02:00.000Z",
    lastProvider: "mock",
    fallbackUsed: false,
    recent: [
      {
        at: "2026-09-10T01:00:00.000Z",
        mode: "hint",
        level: 1,
        answerRevealed: false,
        provider: "mock",
      },
      {
        at: "2026-09-10T01:02:00.000Z",
        mode: "chat",
        level: 6,
        answerRevealed: true,
        provider: "mock",
      },
    ],
  };
}

describe("Student AI context with assistance-aware performance", () => {
  it("separa acurácia bruta de evidência independente sem alterar o resultado oficial", () => {
    const question: Question = {
      providerId: "enem",
      index: 1,
      year: 2023,
      discipline: "matematica",
      context: "Uma questão de teste.",
      alternatives: [
        { letter: "A", text: "Um" },
        { letter: "B", text: "Dois", isCorrect: true },
      ],
      correctAlternative: "B",
    };
    const topic = classifyContent(question);
    const rows = [
      makeRow({ key: "q-independent-correct", content: topic, isCorrect: true }),
      makeRow({ key: "q-assisted-correct", content: topic, isCorrect: true }),
      makeRow({ key: "q-independent-wrong", content: topic, isCorrect: false, selected: "B" }),
    ];
    const attempt = makeAttempt({
      id: "attempt-history",
      providerId: "enem",
      aiAssistance: {
        "q-assisted-correct": highAssistanceTrace(),
      },
      result: { rows, correct: 2, total: 3, blank: 0 },
    });
    const active = makeAttempt({
      id: "attempt-active",
      providerId: "enem",
      finishedAt: null,
      result: null,
      aiAssistance: {
        "2023-1": highAssistanceTrace(),
      },
    });
    const db = makeDB({ attempts: [attempt, active] });

    const snapshot = buildStudentSnapshot(
      db,
      question,
      "A",
      "enem",
      "attempt-active",
    ).student;

    expect(snapshot.recentAccuracy).toBe(67);
    expect(snapshot.recentIndependence).toEqual({
      independentQuestions: 2,
      independentAccuracy: 50,
      highAssistanceQuestions: 1,
      correctWithHighAssistance: 1,
      correctWithHighAssistanceShare: 50,
    });
    expect(snapshot.topicIndependence).toEqual(snapshot.recentIndependence);
    expect(snapshot.currentQuestionAssistance).toMatchObject({
      requests: 2,
      maxLevel: 6,
      answerRevealed: true,
      highAssistance: true,
    });
    expect(attempt.result?.correct).toBe(2);
  });
});
