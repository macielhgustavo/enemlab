import { describe, expect, it } from "vitest";
import { makeAttempt, makeDB, makeRow } from "./__fixtures__/db";
import { mergeStudyIntelligenceState } from "./study-intelligence-merge";
import {
  assignExperimentVariant,
  completeExperiment,
  completeStudyDecision,
  decisionHistory,
  ensureStudyIntelligence,
  experimentSummary,
  feedbackWeightMultipliers,
  providerStudyConfig,
  recordExperiment,
  recordStudyDecision,
  recordStudyFeedback,
  setProviderStudyConfig,
  temporalBlockSize,
} from "./study-learning";
import type { DB, ResultRow } from "./types";

function addFeedbackDecision(
  db: DB,
  id: string,
  usefulness: "helpful" | "neutral" | "not_helpful",
  signal: "weakness" | "sample" = "weakness",
) {
  recordStudyDecision(db, {
    id,
    providerId: "enem",
    at: `2026-09-1${id.slice(-1)}T12:00:00.000Z`,
    objective: "balanced",
    questionKeys: [`q-${id}`],
    dominantSignal: signal,
  });
  recordStudyFeedback(db, id, usefulness, "2026-09-14T12:00:00.000Z");
}

function fatigueAttempt(id: string, startedAt: string): ReturnType<typeof makeAttempt> {
  const rows: ResultRow[] = Array.from({ length: 9 }, (_, index) =>
    makeRow({
      key: `${id}-${index}`,
      index: index + 1,
      content: "Funções",
      tags: ["Funções"],
      selected: index < 6 ? "A" : "B",
      correct: "A",
      isCorrect: index < 6,
      timeSec: 300,
      finishedAt: startedAt,
    }),
  );
  return makeAttempt({
    id,
    startedAt,
    finishedAt: startedAt,
    elapsed: 3600,
    result: { rows, correct: 6, total: 9, blank: 0 },
  });
}

describe("study feedback and history", () => {
  it("does not personalize from one click and clamps learning to ten percent", () => {
    const db = makeDB();
    addFeedbackDecision(db, "d1", "helpful");
    expect(feedbackWeightMultipliers(db, "enem", "balanced")).toEqual({});

    addFeedbackDecision(db, "d2", "helpful");
    addFeedbackDecision(db, "d3", "helpful");
    expect(feedbackWeightMultipliers(db, "enem", "balanced").weakness).toBe(1.1);

    addFeedbackDecision(db, "d4", "not_helpful", "sample");
    addFeedbackDecision(db, "d5", "not_helpful", "sample");
    addFeedbackDecision(db, "d6", "not_helpful", "sample");
    expect(feedbackWeightMultipliers(db, "enem", "balanced").sample).toBe(0.9);
  });

  it("stores outcomes and returns provider-scoped decision history newest first", () => {
    const db = makeDB();
    recordStudyDecision(db, {
      id: "old",
      providerId: "enem",
      at: "2026-09-10T12:00:00.000Z",
      objective: "recovery",
      questionKeys: ["e1"],
      readinessBefore: 50,
    });
    recordStudyDecision(db, {
      id: "new",
      providerId: "enem",
      at: "2026-09-14T12:00:00.000Z",
      objective: "gain",
      questionKeys: ["e2"],
      readinessBefore: 55,
    });
    recordStudyDecision(db, {
      id: "other",
      providerId: "unesp",
      at: "2026-09-15T12:00:00.000Z",
      objective: "coverage",
      questionKeys: ["u1"],
    });
    completeStudyDecision(db, "new", { readinessAfter: 59, accuracyAfter: 80 });

    const history = decisionHistory(db, "enem");
    expect(history.map((item) => item.id)).toEqual(["new", "old"]);
    expect(history[0].readinessAfter).toBe(59);
    expect(history[0].accuracyAfter).toBe(80);
  });

  it("keeps provider configuration independent", () => {
    const db = makeDB();
    setProviderStudyConfig(db, "enem", { objective: "recovery", targetReadiness: 75 });
    setProviderStudyConfig(db, "unesp", { objective: "coverage", targetCoverage: 80 });
    expect(providerStudyConfig(db, "enem")).toMatchObject({ objective: "recovery", targetReadiness: 75 });
    expect(providerStudyConfig(db, "unesp")).toMatchObject({ objective: "coverage", targetCoverage: 80 });
  });
});

describe("temporal adaptation", () => {
  it("never increases workload and only reduces it after repeated fatigue evidence", () => {
    const oneFatigue = makeDB({ attempts: [fatigueAttempt("f1", "2026-09-10T09:00:00.000Z")] });
    expect(temporalBlockSize(oneFatigue, "enem", 20, 3)).toBe(20);

    const repeated = makeDB({
      attempts: [
        fatigueAttempt("f1", "2026-09-10T09:00:00.000Z"),
        fatigueAttempt("f2", "2026-09-11T09:00:00.000Z"),
      ],
    });
    const adjusted = temporalBlockSize(repeated, "enem", 20, 3);
    expect(adjusted).toBeLessThan(20);
    expect(adjusted).toBeGreaterThanOrEqual(5);
    expect(temporalBlockSize(repeated, "enem", 5, 3)).toBe(5);
  });
});

describe("internal experiments", () => {
  it("assigns variants deterministically", () => {
    const variants = ["control", "coverage"];
    const first = assignExperimentVariant("adaptive-v1", "decision-123", variants);
    const second = assignExperimentVariant("adaptive-v1", "decision-123", variants);
    expect(first).toBe(second);
    expect(variants).toContain(first);
  });

  it("refuses significance claims and becomes only directional after five per arm", () => {
    const db = makeDB();
    for (const variant of ["control", "coverage"]) {
      for (let index = 0; index < 5; index++) {
        const id = `${variant}-${index}`;
        recordExperiment(db, {
          id,
          experimentId: "adaptive-v1",
          variant,
          providerId: "enem",
          decisionId: `decision-${id}`,
          at: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
        });
        completeExperiment(db, id, {
          completedAt: "2026-09-14T12:00:00.000Z",
          readinessDelta: variant === "coverage" ? 2 : 1,
          accuracy: variant === "coverage" ? 75 : 70,
          feedback: "helpful",
        });
      }
    }
    const summary = experimentSummary(db, "adaptive-v1");
    expect(summary.status).toBe("directional");
    expect(summary.note).toMatch(/não implica significância estatística/i);
    expect(summary.variants).toHaveLength(2);
  });
});

describe("learning state merge", () => {
  it("unions event maps and lets current-device fields win on the same ids", () => {
    const cloud = {
      decisions: {
        shared: {
          id: "shared",
          providerId: "enem",
          at: "2026-09-10T00:00:00.000Z",
          objective: "balanced" as const,
          questionKeys: ["cloud"],
          topReasons: ["cloud"],
        },
        cloudOnly: {
          id: "cloudOnly",
          providerId: "enem",
          at: "2026-09-10T00:00:00.000Z",
          objective: "balanced" as const,
          questionKeys: ["cloudOnly"],
          topReasons: [],
        },
      },
      experiments: {},
      providerConfig: { enem: { objective: "coverage" as const, targetCoverage: 70 } },
    };
    const local = {
      decisions: {
        shared: {
          id: "shared",
          providerId: "enem",
          at: "2026-09-11T00:00:00.000Z",
          objective: "recovery" as const,
          questionKeys: ["local"],
          topReasons: ["local"],
        },
      },
      experiments: {},
      providerConfig: { enem: { objective: "recovery" as const, targetReadiness: 75 } },
    };

    const merged = mergeStudyIntelligenceState(cloud, local)!;
    expect(Object.keys(merged.decisions).sort()).toEqual(["cloudOnly", "shared"]);
    expect(merged.decisions.shared.questionKeys).toEqual(["local"]);
    expect(merged.providerConfig.enem).toEqual({
      objective: "recovery",
      targetCoverage: 70,
      targetReadiness: 75,
    });
  });

  it("initializes the optional state lazily", () => {
    const db = makeDB();
    expect(db.studyIntelligence).toBeUndefined();
    expect(ensureStudyIntelligence(db)).toEqual({ decisions: {}, experiments: {}, providerConfig: {} });
  });
});
