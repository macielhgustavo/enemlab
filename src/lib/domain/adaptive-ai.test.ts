import { describe, expect, it } from "vitest";
import { studentAIDiagnosticPressureByContent } from "./adaptive";
import { makeAttempt, makeDB, makeRow } from "./__fixtures__/db";
import type {
  StudentAIAssistanceTrace,
  StudentAIDiagnosticCategory,
  StudentAIDiagnosticConfidence,
} from "./types";

function trace(
  category: StudentAIDiagnosticCategory,
  confidence: StudentAIDiagnosticConfidence = "high",
): StudentAIAssistanceTrace {
  return {
    requests: 1,
    maxLevel: 4,
    answerRevealed: false,
    modes: ["why-wrong"],
    firstAt: "2026-01-10T11:30:00.000Z",
    lastAt: "2026-01-10T11:30:00.000Z",
    lastProvider: "openrouter",
    fallbackUsed: false,
    recent: [
      {
        at: "2026-01-10T11:30:00.000Z",
        mode: "why-wrong",
        level: 4,
        answerRevealed: false,
        provider: "openrouter",
        diagnostic: { category, confidence },
      },
    ],
  };
}

describe("Student AI diagnostic pressure in Adaptive", () => {
  it("usa diagnóstico alto como bônus pequeno por conteúdo", () => {
    const row = makeRow({
      key: "q-1",
      content: "Porcentagem e juros",
      tags: ["Porcentagem e juros"],
    });
    const attempt = makeAttempt({
      id: "a-diagnostic",
      result: { rows: [row], correct: 1, total: 1, blank: 0 },
      aiAssistance: { "q-1": trace("content-gap") },
    });
    const db = makeDB({ attempts: [attempt] });

    expect(studentAIDiagnosticPressureByContent(db)["Porcentagem e juros"]).toBe(8);
  });

  it("ignora diagnóstico de confiança média ou baixa", () => {
    const row = makeRow({ key: "q-1", content: "Funções", tags: ["Funções"] });
    const attempt = makeAttempt({
      id: "a-medium",
      result: { rows: [row], correct: 1, total: 1, blank: 0 },
      aiAssistance: { "q-1": trace("strategy", "medium") },
    });
    const db = makeDB({ attempts: [attempt] });

    expect(studentAIDiagnosticPressureByContent(db)["Funções"]).toBeUndefined();
  });

  it("limita a pressão acumulada mesmo com vários diagnósticos altos", () => {
    const rows = [1, 2, 3].map((index) =>
      makeRow({
        key: `q-${index}`,
        index,
        content: "Geometria plana",
        tags: ["Geometria plana"],
      }),
    );
    const attempt = makeAttempt({
      id: "a-capped",
      result: { rows, correct: 3, total: 3, blank: 0 },
      aiAssistance: Object.fromEntries(
        rows.map((row) => [row.key, trace("content-gap")]),
      ),
    });
    const db = makeDB({ attempts: [attempt] });

    expect(studentAIDiagnosticPressureByContent(db)["Geometria plana"]).toBe(18);
  });
});
