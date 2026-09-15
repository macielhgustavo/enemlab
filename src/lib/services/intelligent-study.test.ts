import { describe, expect, it } from "vitest";
import { makeDB } from "../domain/__fixtures__/db";
import { finalizePendingStudyIntelligence } from "../domain/study-learning-finalize";
import { finishAttemptInDB, questionsForAttempt } from "./attempts";
import {
  buildIntelligentStudyLaunch,
  loadIntelligencePreview,
  persistIntelligentStudyLaunch,
} from "./intelligent-study";

describe("intelligent study integration", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("builds and persists an objective launch inside the active provider", async () => {
    const db = makeDB();
    const launch = await buildIntelligentStudyLaunch(
      db,
      "unesp",
      { kind: "objective", objective: "coverage", n: 5 },
      now,
    );

    expect(launch.attempt.providerId).toBe("unesp");
    expect(launch.attempt.questionRefs.length).toBeGreaterThan(0);
    expect(launch.attempt.questionRefs.every((ref) => ref.providerId === "unesp")).toBe(true);
    expect(launch.decision.attemptId).toBe(launch.attempt.id);

    persistIntelligentStudyLaunch(db, launch);
    expect(db.attempts[0].id).toBe(launch.attempt.id);
    expect(db.studyIntelligence?.decisions[launch.decision.id]?.objective).toBe("coverage");
    expect(db.studyIntelligence?.providerConfig.unesp?.objective).toBe("coverage");
  });

  it("creates a 20–30 question diagnostic and a real provider-scoped preview", async () => {
    const db = makeDB();
    const diagnostic = await buildIntelligentStudyLaunch(
      db,
      "unesp",
      { kind: "diagnostic", n: 25 },
      now,
    );
    expect(diagnostic.attempt.questionRefs).toHaveLength(25);
    expect(diagnostic.decision.objective).toBe("coverage");
    expect(diagnostic.experiment).toBeUndefined();

    const preview = await loadIntelligencePreview(db, "unesp", "balanced", now);
    expect(preview.providerId).toBe("unesp");
    expect(preview.poolSize).toBeGreaterThanOrEqual(25);
    expect(preview.queue.length).toBeGreaterThan(0);
    expect(preview.queue.every((item) => item.providerId === "unesp")).toBe(true);
    expect(preview.coverage.expected).toBe(preview.expectedContents.length || null);
    expect(preview.readiness.note).toMatch(/não é nota prevista/i);
  });

  it("closes recorded outcomes before the next adaptive decision", async () => {
    const db = makeDB();
    const launch = await buildIntelligentStudyLaunch(
      db,
      "unesp",
      { kind: "objective", objective: "balanced", n: 5 },
      now,
    );
    persistIntelligentStudyLaunch(db, launch);

    const questions = await questionsForAttempt(launch.attempt);
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      const ref = launch.attempt.questionRefs.find(
        (item) => item.index === question.index && item.year === question.year,
      );
      if (ref?.questionKey && question.correctAlternative) {
        launch.attempt.answers[ref.questionKey] = question.correctAlternative;
      }
    }

    finishAttemptInDB(db, launch.attempt.id, questions);
    expect(finalizePendingStudyIntelligence(db, "unesp")).toBe(1);
    const decision = db.studyIntelligence?.decisions[launch.decision.id];
    expect(decision?.readinessAfter).not.toBeNull();
    expect(decision?.accuracyAfter).not.toBeNull();
    if (launch.experiment) {
      expect(db.studyIntelligence?.experiments[launch.experiment.id]?.completedAt).toBeTruthy();
    }
  });
});
