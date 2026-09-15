import { DEFAULT_PROVIDER_ID, resolveProviderId } from "../providers/registry";
import { officialRowsOf } from "./stats";
import { coverageSnapshot, readinessSnapshot, type ReadinessSnapshot } from "./study-intelligence";
import type { DB } from "./types";

export interface ProviderStudyGoal {
  providerId: string;
  targetDate?: string | null;
  weeklyQuestions?: number | null;
  targetCoverage?: number | null;
  targetReadiness?: number | null;
}

export interface GoalProgress {
  providerId: string;
  daysRemaining: number | null;
  weeklyQuestionsDone: number;
  weeklyQuestionsTarget: number;
  weeklyPacePct: number | null;
  readiness: ReadinessSnapshot;
  readinessGap: number | null;
  coveragePct: number | null;
  coverageGap: number | null;
  status: "calibrating" | "behind" | "on-track" | "ahead";
  reasons: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizedTarget(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? clamp(Number(value), 0, 100) : null;
}

function daysUntil(targetDate: string | null | undefined, now: Date): number | null {
  if (!targetDate) return null;
  const target = new Date(targetDate);
  if (!Number.isFinite(target.getTime())) return null;
  const dayMs = 86400000;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - start.getTime()) / dayMs);
}

/**
 * Progresso para uma prova-alvo sem converter readiness em previsão de nota.
 * Cobertura só entra quando o chamador fornece o conjunto esperado de conteúdos.
 */
export function studyGoalProgress(
  db: DB,
  goal: ProviderStudyGoal,
  expectedContents?: string[],
  now: Date = new Date(),
): GoalProgress {
  const providerId = resolveProviderId(goal.providerId || DEFAULT_PROVIDER_ID);
  const weekStart = now.getTime() - 7 * 86400000;
  const weeklyQuestionsDone = officialRowsOf(db, providerId).filter((row) => {
    if (!row.finishedAt) return false;
    const timestamp = +new Date(row.finishedAt);
    return Number.isFinite(timestamp) && timestamp >= weekStart && timestamp <= now.getTime();
  }).length;
  const weeklyQuestionsTarget = Math.max(0, Math.round(goal.weeklyQuestions ?? db.goals.questions ?? 0));
  const weeklyPacePct = weeklyQuestionsTarget
    ? Math.round((weeklyQuestionsDone / weeklyQuestionsTarget) * 100)
    : null;
  const readiness = readinessSnapshot(db, providerId, expectedContents);
  const coverage = coverageSnapshot(db, providerId, expectedContents);
  const targetReadiness = normalizedTarget(goal.targetReadiness);
  const targetCoverage = normalizedTarget(goal.targetCoverage);
  const readinessGap = targetReadiness === null ? null : Math.max(0, targetReadiness - readiness.score);
  const coveragePct = coverage.calibratedPct;
  const coverageGap = targetCoverage === null || coveragePct === null
    ? null
    : Math.max(0, targetCoverage - coveragePct);
  const daysRemaining = daysUntil(goal.targetDate, now);
  const reasons: string[] = [];

  if (weeklyPacePct !== null && weeklyPacePct < 80) {
    reasons.push(`Ritmo semanal em ${weeklyPacePct}% da meta (${weeklyQuestionsDone}/${weeklyQuestionsTarget}).`);
  }
  if (readinessGap !== null && readinessGap > 0) {
    reasons.push(`Faltam ${readinessGap} ponto(s) no índice de prontidão configurado.`);
  }
  if (targetCoverage !== null && coveragePct === null) {
    reasons.push("Cobertura-alvo não pode ser medida sem um denominador explícito de conteúdos.");
  } else if (coverageGap !== null && coverageGap > 0) {
    reasons.push(`Cobertura calibrada está ${coverageGap} ponto(s) abaixo da meta.`);
  }
  if (daysRemaining !== null && daysRemaining < 0) {
    reasons.push("A data-alvo já passou; atualize a meta antes de interpretar o ritmo.");
  } else if (daysRemaining !== null && daysRemaining <= 14) {
    reasons.push(`Restam ${daysRemaining} dia(s) até a prova-alvo.`);
  }
  if (readiness.confidence === "baixa") {
    reasons.push("A leitura ainda tem baixa confiança por falta de evidência.");
  }

  const hasComparableTargets = weeklyPacePct !== null || readinessGap !== null || coverageGap !== null;
  const status: GoalProgress["status"] = !hasComparableTargets || readiness.confidence === "baixa"
    ? "calibrating"
    : (weeklyPacePct !== null && weeklyPacePct < 80) || (readinessGap !== null && readinessGap >= 12) || (coverageGap !== null && coverageGap >= 15)
      ? "behind"
      : (weeklyPacePct === null || weeklyPacePct >= 110) && (readinessGap === null || readinessGap === 0) && (coverageGap === null || coverageGap === 0)
        ? "ahead"
        : "on-track";

  return {
    providerId,
    daysRemaining,
    weeklyQuestionsDone,
    weeklyQuestionsTarget,
    weeklyPacePct,
    readiness,
    readinessGap,
    coveragePct,
    coverageGap,
    status,
    reasons,
  };
}
