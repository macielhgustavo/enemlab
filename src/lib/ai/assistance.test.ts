import { describe, expect, it } from "vitest";
import { defaultDB } from "../store";
import {
  assistanceForQuestion,
  isHighAssistance,
  recordStudentAIAssistance,
} from "./assistance";
import type { AIResponse } from "./types";

function response(
  overrides: Partial<AIResponse> = {},
): AIResponse {
  return {
    mode: "hint",
    level: 1,
    title: "Pista",
    explanation: "Explicação",
    concepts: ["Porcentagem"],
    nextStep: "Continue",
    revealAnswer: false,
    provider: "mock",
    ...overrides,
  };
}

function dbWithAttempt() {
  const db = defaultDB();
  db.attempts.push({
    id: "attempt-ai",
    providerId: "enem",
    year: 2023,
    lang: "ingles",
    mode: "sprint15",
    area: "matematica",
    minutes: 50,
    strict: false,
    questionRefs: [],
    answers: {},
    confidence: {},
    flags: {},
    timeQ: {},
    elapsed: 0,
    startedAt: "2026-09-10T00:00:00.000Z",
    finishedAt: null,
    result: null,
  });
  return db;
}

describe("Student AI assistance trace", () => {
  it("agrega nível, modos e revelação por questão sem persistir conteúdo", () => {
    const db = dbWithAttempt();
    recordStudentAIAssistance(
      db,
      "attempt-ai",
      "q-1",
      response(),
      "2026-09-10T01:00:00.000Z",
    );
    recordStudentAIAssistance(
      db,
      "attempt-ai",
      "q-1",
      response({ mode: "why-wrong", level: 4 }),
      "2026-09-10T01:01:00.000Z",
    );
    recordStudentAIAssistance(
      db,
      "attempt-ai",
      "q-1",
      response({
        mode: "chat",
        level: 6,
        revealAnswer: true,
        answer: "B",
        provider: "mock",
        fallbackFrom: "openai-compatible",
      }),
      "2026-09-10T01:02:00.000Z",
    );

    const trace = assistanceForQuestion(db, "attempt-ai", "q-1");
    expect(trace).toMatchObject({
      requests: 3,
      maxLevel: 6,
      answerRevealed: true,
      modes: ["hint", "why-wrong", "chat"],
      firstAt: "2026-09-10T01:00:00.000Z",
      lastAt: "2026-09-10T01:02:00.000Z",
      lastProvider: "mock",
      fallbackUsed: true,
    });
    expect(trace?.recent).toHaveLength(3);
    expect(JSON.stringify(trace)).not.toContain("Explicação");
    expect(JSON.stringify(trace)).not.toContain("Porcentagem");
    expect(isHighAssistance(trace)).toBe(true);
  });

  it("mantém só uma janela recente, mas preserva o contador total", () => {
    const db = dbWithAttempt();
    for (let i = 0; i < 15; i++) {
      recordStudentAIAssistance(
        db,
        "attempt-ai",
        "q-1",
        response(),
        `2026-09-10T01:${String(i).padStart(2, "0")}:00.000Z`,
      );
    }

    const trace = assistanceForQuestion(db, "attempt-ai", "q-1");
    expect(trace?.requests).toBe(15);
    expect(trace?.recent).toHaveLength(12);
    expect(trace?.recent[0].at).toBe("2026-09-10T01:03:00.000Z");
    expect(isHighAssistance(trace)).toBe(false);
  });

  it("não cria rastro quando a tentativa não existe", () => {
    const db = defaultDB();
    expect(recordStudentAIAssistance(db, "missing", "q-1", response())).toBe(false);
    expect(db.attempts).toHaveLength(0);
  });
});
