import { describe, expect, it } from "vitest";
import { makeAttempt, makeDB } from "./__fixtures__/db";
import { providerStudyConfig, setProviderStudyConfig } from "./study-learning";
import {
  completeStudyOnboarding,
  needsStudyOnboarding,
  skipStudyOnboarding,
  studyOnboardingDefaults,
} from "./study-onboarding";

describe("study onboarding", () => {
  it("é necessário apenas para um provider novo sem histórico ou configuração", () => {
    const db = makeDB({ activeProvider: "enem" });
    expect(needsStudyOnboarding(db, "enem")).toBe(true);

    db.attempts.push(makeAttempt({ providerId: "enem" }));
    expect(needsStudyOnboarding(db, "enem")).toBe(false);
  });

  it("respeita configuração existente mesmo sem histórico", () => {
    const db = makeDB();
    setProviderStudyConfig(db, "enem", { objective: "recovery" });
    expect(needsStudyOnboarding(db, "enem")).toBe(false);
  });

  it("conclui sem apagar histórico e preserva configuração por prova", () => {
    const attempt = makeAttempt({ providerId: "enem" });
    const db = makeDB({ attempts: [attempt] });

    completeStudyOnboarding(db, {
      providerId: "enem",
      objective: "recovery",
      targetDate: "2027-11-07",
      weeklyQuestions: 210,
      dailyMinutes: 90,
      completedAt: "2026-09-22T12:00:00.000Z",
    });
    completeStudyOnboarding(db, {
      providerId: "ita",
      objective: "coverage",
      targetDate: "2027-09-01",
      weeklyQuestions: 120,
      dailyMinutes: 60,
      completedAt: "2026-09-22T12:01:00.000Z",
    });

    expect(db.attempts).toEqual([attempt]);
    expect(providerStudyConfig(db, "enem")).toMatchObject({
      objective: "recovery",
      weeklyQuestions: 210,
      dailyMinutes: 90,
    });
    expect(providerStudyConfig(db, "ita")).toMatchObject({
      objective: "coverage",
      weeklyQuestions: 120,
      dailyMinutes: 60,
    });
    expect(db.activeProvider).toBe("ita");
  });

  it("pular grava defaults seguros no mesmo modelo", () => {
    const db = makeDB({ goals: { questions: 175, essays: 1, reviews: 30 } });
    skipStudyOnboarding(db, "enem", "2026-09-22T12:00:00.000Z");

    expect(providerStudyConfig(db, "enem")).toMatchObject({
      objective: "balanced",
      weeklyQuestions: 175,
      dailyMinutes: 60,
      onboardingCompletedAt: "2026-09-22T12:00:00.000Z",
    });
    expect(studyOnboardingDefaults(db, "enem").weeklyQuestions).toBe(175);
  });
});
