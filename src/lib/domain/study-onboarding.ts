import { resolveProviderId, sameProvider } from "../providers";
import type { DB, StudyObjectiveId } from "./types";
import { providerStudyConfig, setProviderStudyConfig } from "./study-learning";

export interface StudyOnboardingDraft {
  providerId: string;
  objective: StudyObjectiveId;
  targetDate: string;
  weeklyQuestions: number;
  dailyMinutes: number;
}

export interface CompleteStudyOnboardingInput extends StudyOnboardingDraft {
  completedAt?: string;
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function studyOnboardingDefaults(
  db: DB,
  providerId: string,
): StudyOnboardingDraft {
  const scoped = resolveProviderId(providerId);
  const config = providerStudyConfig(db, scoped);
  return {
    providerId: scoped,
    objective: config.objective ?? "balanced",
    targetDate: config.targetDate ?? "",
    weeklyQuestions: clampInt(
      config.weeklyQuestions ?? db.goals.questions ?? 150,
      20,
      2000,
      150,
    ),
    dailyMinutes: clampInt(config.dailyMinutes ?? 60, 20, 360, 60),
  };
}

export function needsStudyOnboarding(db: DB, providerId: string): boolean {
  const scoped = resolveProviderId(providerId);
  const config = providerStudyConfig(db, scoped);

  if (config.onboardingCompletedAt) return false;

  const hasConfig = Object.values(config).some(
    (value) => value !== undefined && value !== null && value !== "",
  );
  if (hasConfig) return false;

  const hasHistory = db.attempts.some((attempt) =>
    sameProvider(attempt.providerId, scoped),
  );
  return !hasHistory;
}

export function completeStudyOnboarding(
  db: DB,
  input: CompleteStudyOnboardingInput,
) {
  const providerId = resolveProviderId(input.providerId);
  db.activeProvider = providerId;
  return setProviderStudyConfig(db, providerId, {
    objective: input.objective,
    targetDate: input.targetDate.trim() || null,
    weeklyQuestions: clampInt(input.weeklyQuestions, 20, 2000, 150),
    dailyMinutes: clampInt(input.dailyMinutes, 20, 360, 60),
    onboardingCompletedAt: input.completedAt ?? new Date().toISOString(),
  });
}

export function skipStudyOnboarding(
  db: DB,
  providerId: string,
  completedAt = new Date().toISOString(),
) {
  const defaults = studyOnboardingDefaults(db, providerId);
  return completeStudyOnboarding(db, {
    ...defaults,
    completedAt,
  });
}
