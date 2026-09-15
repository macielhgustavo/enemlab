import { describe, expect, it } from "vitest";
import { makeAttempt, makeDB, makeRow } from "./__fixtures__/db";
import {
  contentEvidence,
  counterfactualForContent,
  coverageSnapshot,
  falseErrorSignals,
  falseMasterySignals,
  knowledgeExecutionSplit,
  readinessSnapshot,
  temporalProfile,
} from "./study-intelligence";
import type { ResultRow } from "./types";

function row(index: number, content: string, correct: boolean, over: Partial<ResultRow> = {}) {
  return makeRow({
    key: `q-${index}`,
    index,
    content,
    tags: [content],
    selected: correct ? "A" : "B",
    correct: "A",
    isCorrect: correct,
    confidence: correct ? "duvida" : "duvida",
    timeSec: 90,
    ...over,
  });
}

function attempt(id: string, rows: ResultRow[], startedAt = "2026-09-10T09:00:00.000Z", elapsed = 1800) {
  return makeAttempt({
    id,
    startedAt,
    finishedAt: new Date(new Date(startedAt).getTime() + elapsed * 1000).toISOString(),
    elapsed,
    result: {
      rows,
      correct: rows.filter((item) => item.isCorrect).length,
      total: rows.length,
      blank: 0,
    },
  });
}

describe("study intelligence evidence", () => {
  it("keeps short samples low-confidence even when accuracy is perfect", () => {
    const db = makeDB({
      attempts: [attempt("short", [row(1, "Funções", true), row(2, "Funções", true), row(3, "Funções", true)])],
    });
    const evidence = contentEvidence(db, "enem", new Date("2026-09-14T12:00:00.000Z"))[0];
    expect(evidence.total).toBe(3);
    expect(evidence.accuracy).toBe(100);
    expect(evidence.confidence).toBe("baixa");
  });

  it("measures coverage only against an explicit denominator", () => {
    const db = makeDB({
      attempts: [attempt("coverage", [
        row(1, "Funções", true),
        row(2, "Funções", true),
        row(3, "Funções", false),
        row(4, "Funções", true),
        row(5, "Probabilidade", true),
      ])],
    });
    const unknownDenominator = coverageSnapshot(db, "enem");
    expect(unknownDenominator.expected).toBeNull();
    expect(unknownDenominator.observedPct).toBeNull();

    const known = coverageSnapshot(db, "enem", ["Funções", "Probabilidade", "Estatística"]);
    expect(known.expected).toBe(3);
    expect(known.observed).toBe(2);
    expect(known.calibrated).toBe(1);
    expect(known.calibrating).toBe(1);
    expect(known.untested).toBe(1);
    expect(known.observedPct).toBe(67);
    expect(known.calibratedPct).toBe(33);
  });
});

describe("study intelligence risk signals", () => {
  it("flags apparent mastery that collapses on hard/costly items", () => {
    const rows = [
      row(1, "Geometria plana", true),
      row(2, "Geometria plana", true),
      row(3, "Geometria plana", true),
      row(4, "Geometria plana", true),
      row(5, "Geometria plana", true),
      row(6, "Geometria plana", true),
      row(7, "Geometria plana", false, { difficulty: "dificil", timeSec: 300 }),
      row(8, "Geometria plana", false, { difficulty: "dificil", timeSec: 320 }),
    ];
    const signals = falseMasterySignals(makeDB({ attempts: [attempt("mastery", rows)] }), "enem");
    expect(signals).toHaveLength(1);
    expect(signals[0].accuracy).toBe(75);
    expect(signals[0].hardAccuracy).toBe(0);
    expect(signals[0].risk).toBeGreaterThanOrEqual(55);
  });

  it("distinguishes an execution slip from a confident conceptual error", () => {
    const rows = [
      row(1, "Funções", true),
      row(2, "Funções", true),
      row(3, "Funções", true),
      row(4, "Funções", true),
      row(5, "Funções", true),
      row(6, "Funções", true),
      row(7, "Funções", false, { confidence: "duvida", timeSec: 260 }),
      row(8, "Funções", false, { confidence: "certeza", timeSec: 80 }),
    ];
    const a = attempt("errors", rows);
    const db = makeDB({
      attempts: [a],
      notes: {
        "errors|q-7": { knew: "pressa", reason: "Tempo/pressa" },
      },
    });
    const signals = falseErrorSignals(db, "enem");
    const pressa = signals.find((item) => item.key === "q-7");
    const certeza = signals.find((item) => item.key === "q-8");
    expect(pressa?.likelyExecutionNoise).toBe(true);
    expect(certeza?.likelyExecutionNoise).toBe(false);
  });

  it("separates knowledge from test execution", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(index + 1, "Funções", index < 8));
    const db = makeDB({
      attempts: [attempt("split", rows)],
      notes: {
        "split|q-9": { knew: "pressa", reason: "Desatenção" },
        "split|q-10": { knew: "pressa", reason: "Tempo/pressa" },
      },
    });
    const split = knowledgeExecutionSplit(db, "enem");
    expect(split.actualAccuracy).toBe(80);
    expect(split.knowledgeScore).toBe(100);
    expect(split.executionErrors).toBe(2);
    expect(split.executionScore).toBeLessThan(100);
    expect(split.diagnosis).toBe("execucao");
  });
});

describe("study intelligence temporal/readiness", () => {
  it("finds the strongest time bucket and a fatigue threshold only from evidence", () => {
    const morningRows = [
      row(1, "Funções", true), row(2, "Funções", true), row(3, "Funções", true),
      row(4, "Funções", true), row(5, "Funções", true), row(6, "Funções", true),
      row(7, "Funções", false), row(8, "Funções", false), row(9, "Funções", false),
    ];
    const nightRows = Array.from({ length: 6 }, (_, index) => row(20 + index, "Probabilidade", index < 3));
    const db = makeDB({
      attempts: [
        attempt("morning", morningRows, "2026-09-10T09:00:00.000Z", 3600),
        attempt("night", nightRows, "2026-09-11T20:00:00.000Z", 1800),
      ],
    });
    const profile = temporalProfile(db, "enem");
    expect(profile.bestBucket?.id).toBe("manha");
    expect(profile.fatiguedAttempts).toBe(1);
    expect(profile.fatigueThresholdMinutes).toBe(40);
  });

  it("keeps readiness explicitly separate from predicted exam score", () => {
    const rows = Array.from({ length: 20 }, (_, index) => row(index + 1, index < 10 ? "Funções" : "Probabilidade", index % 4 !== 0));
    const db = makeDB({ attempts: [attempt("ready", rows)] });
    const ready = readinessSnapshot(db, "enem", ["Funções", "Probabilidade", "Estatística"]);
    expect(ready.score).toBeGreaterThanOrEqual(0);
    expect(ready.score).toBeLessThanOrEqual(100);
    expect(ready.sample).toBe(20);
    expect(ready.note).toMatch(/não é nota prevista/i);
    expect(ready.components.coverage).toBe(67);
  });

  it("explains what would change a content priority", () => {
    const weak = {
      content: "Funções",
      correct: 2,
      total: 4,
      accuracy: 50,
      interval: { low: 15, high: 85, width: 70 },
      evidenceScore: 45,
      confidence: "baixa" as const,
      latestAt: null,
      recentAccuracy: 50,
    };
    expect(counterfactualForContent(weak)[0]).toContain("2 acerto");
    expect(counterfactualForContent(null)[0]).toContain("4 questões");
  });
});
