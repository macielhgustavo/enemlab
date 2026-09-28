import { pct } from "../format";
import { getProvider, resolveProviderId } from "../providers";
import { areasOf } from "../providers/taxonomy";
import { officialRowsOf } from "./stats";
import { providerStudyConfig } from "./study-learning";
import { studyGoalProgress } from "./study-goal";
import type { DB } from "./types";

const DAY_MS = 86_400_000;
const REVIEW_MODES = new Set(["srs", "retry", "srs-recall"]);

export type TrajectoryRhythm = "calibrating" | "behind" | "on-track" | "ahead";
export type TrajectoryConfidence = "baixa" | "média" | "alta";

export interface WeeklyMetric {
  key: "questions" | "reviews" | "essays";
  label: string;
  done: number;
  target: number;
  expectedByNow: number;
  pacePct: number | null;
}

export interface AreaWeekPoint {
  weekStart: string;
  label: string;
  correct: number;
  total: number;
  accuracy: number | null;
}

export interface AreaTrajectory {
  id: string;
  label: string;
  correct: number;
  total: number;
  accuracy: number | null;
  confidence: TrajectoryConfidence;
  history: AreaWeekPoint[];
}

export interface WeeklyTrajectory {
  providerId: string;
  targetDate: string | null;
  daysRemaining: number | null;
  weeksRemaining: number | null;
  weekStart: string;
  weekEnd: string;
  elapsedWeekDays: number;
  metrics: WeeklyMetric[];
  rhythm: TrajectoryRhythm;
  rhythmPct: number | null;
  confidence: TrajectoryConfidence;
  reasons: string[];
  areas: AreaTrajectory[];
  nextWeek: {
    questions: number;
    reviews: number;
    essays: number;
    focusArea: string | null;
    note: string;
  };
  baseGoal: ReturnType<typeof studyGoalProgress>;
}

function localDayStart(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function mondayStart(value: Date): Date {
  const date = localDayStart(value);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function dateKey(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function confidenceForSample(total: number): TrajectoryConfidence {
  if (total < 4) return "baixa";
  if (total < 20) return "média";
  return "alta";
}

function expectedByNow(target: number, elapsedWeekDays: number): number {
  if (target <= 0) return 0;
  return Math.max(1, Math.round((target * elapsedWeekDays) / 7));
}

function metric(
  key: WeeklyMetric["key"],
  label: string,
  done: number,
  target: number,
  elapsedWeekDays: number,
): WeeklyMetric {
  const normalizedTarget = Math.max(0, Math.round(target));
  const expected = expectedByNow(normalizedTarget, elapsedWeekDays);
  return {
    key,
    label,
    done,
    target: normalizedTarget,
    expectedByNow: expected,
    pacePct: expected > 0 ? Math.round((done / expected) * 100) : null,
  };
}

function inRange(value: string | null | undefined, start: Date, end: Date): boolean {
  if (!value) return false;
  const time = +new Date(value);
  return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
}

function standaloneEssaysThisWeek(db: DB, providerId: string, start: Date, end: Date): number {
  return (db.essays ?? []).filter(
    (essay) =>
      resolveProviderId(essay.providerId) === providerId &&
      Boolean(essay.finishedAt) &&
      inRange(essay.finishedAt, start, end),
  ).length;
}

function attemptEssaysThisWeek(db: DB, providerId: string, start: Date, end: Date): number {
  return db.attempts.filter(
    (attempt) =>
      resolveProviderId(attempt.providerId) === providerId &&
      Boolean(attempt.essay?.text?.trim()) &&
      Boolean(attempt.finishedAt) &&
      inRange(attempt.finishedAt, start, end),
  ).length;
}

function weeklyAreaHistory(
  db: DB,
  providerId: string,
  areaId: string,
  now: Date,
): AreaWeekPoint[] {
  const currentWeek = mondayStart(now);
  const rows = officialRowsOf(db, providerId).filter((row) => row.area === areaId && row.correct);
  const out: AreaWeekPoint[] = [];

  for (let offset = 5; offset >= 0; offset--) {
    const start = new Date(currentWeek);
    start.setDate(start.getDate() - offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const sample = rows.filter((row) => inRange(row.finishedAt, start, end));
    const correct = sample.filter((row) => row.isCorrect).length;
    out.push({
      weekStart: dateKey(start),
      label: start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      correct,
      total: sample.length,
      accuracy: sample.length ? pct(correct, sample.length) : null,
    });
  }
  return out;
}

export function buildWeeklyTrajectory(
  db: DB,
  providerIdInput: string,
  now: Date = new Date(),
): WeeklyTrajectory {
  const providerId = resolveProviderId(providerIdInput);
  const config = providerStudyConfig(db, providerId);
  const baseGoal = studyGoalProgress(db, { providerId, ...config }, undefined, now);

  const weekStartDate = mondayStart(now);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 7);
  const elapsedWeekDays = Math.min(
    7,
    Math.max(1, Math.floor((localDayStart(now).getTime() - weekStartDate.getTime()) / DAY_MS) + 1),
  );

  const rowsThisWeek = officialRowsOf(db, providerId).filter((row) =>
    inRange(row.finishedAt, weekStartDate, weekEndDate),
  );
  const questionsDone = rowsThisWeek.length;

  const reviewsDone = db.attempts
    .filter(
      (attempt) =>
        REVIEW_MODES.has(attempt.mode) &&
        resolveProviderId(attempt.providerId) === providerId &&
        Boolean(attempt.result) &&
        inRange(attempt.finishedAt, weekStartDate, weekEndDate),
    )
    .reduce((sum, attempt) => sum + (attempt.result?.total || 0), 0);

  const providerHasEssay = getProvider(providerId).metadata.hasEssay;
  const essaysDone = providerHasEssay
    ? standaloneEssaysThisWeek(db, providerId, weekStartDate, weekEndDate) +
      attemptEssaysThisWeek(db, providerId, weekStartDate, weekEndDate)
    : 0;

  const questionTarget = Math.max(
    0,
    Math.round(config.weeklyQuestions ?? db.goals.questions ?? 0),
  );
  const reviewTarget = Math.max(0, Math.round(db.goals.reviews ?? 0));
  const essayTarget = providerHasEssay ? Math.max(0, Math.round(db.goals.essays ?? 0)) : 0;

  const metrics = [
    metric("questions", "Questões", questionsDone, questionTarget, elapsedWeekDays),
    metric("reviews", "Revisões", reviewsDone, reviewTarget, elapsedWeekDays),
    metric("essays", "Redações", essaysDone, essayTarget, elapsedWeekDays),
  ];

  const allRows = officialRowsOf(db, providerId).filter((row) => row.correct);
  const confidence = confidenceForSample(allRows.length);
  const comparable = metrics.filter((item) => item.pacePct !== null && item.target > 0);
  const rhythmPct = comparable.length
    ? Math.round(comparable.reduce((sum, item) => sum + (item.pacePct ?? 0), 0) / comparable.length)
    : null;

  let rhythm: TrajectoryRhythm = "calibrating";
  if (confidence !== "baixa" && rhythmPct !== null) {
    rhythm = rhythmPct < 80 ? "behind" : rhythmPct >= 115 ? "ahead" : "on-track";
  }

  const reasons: string[] = [];
  if (confidence === "baixa") {
    reasons.push(
      `A leitura ainda tem baixa confiança: ${allRows.length} resposta(s) corrigida(s) nesta prova.`,
    );
  }
  for (const item of metrics) {
    if (!item.target) continue;
    if (item.done < item.expectedByNow) {
      reasons.push(
        `${item.label}: ${item.done}/${item.expectedByNow} do esperado até hoje (${item.target} na semana).`,
      );
    } else {
      reasons.push(
        `${item.label}: ${item.done}/${item.expectedByNow} do esperado até hoje.`,
      );
    }
  }

  const areas: AreaTrajectory[] = areasOf(providerId).map((area) => {
    const rows = allRows.filter((row) => row.area === area.id);
    const correct = rows.filter((row) => row.isCorrect).length;
    return {
      id: area.id,
      label: area.label,
      correct,
      total: rows.length,
      accuracy: rows.length ? pct(correct, rows.length) : null,
      confidence: confidenceForSample(rows.length),
      history: weeklyAreaHistory(db, providerId, area.id, now),
    };
  });

  const measuredAreas = areas
    .filter((area) => area.total >= 4 && area.accuracy !== null)
    .sort((a, b) => (a.accuracy ?? 100) - (b.accuracy ?? 100));
  const calibrationAreas = areas
    .filter((area) => area.total < 4)
    .sort((a, b) => a.total - b.total);

  const focusArea = measuredAreas[0]?.label ?? calibrationAreas[0]?.label ?? null;
  const targetDate = config.targetDate?.trim() || null;
  const daysRemaining = baseGoal.daysRemaining;
  const weeksRemaining =
    daysRemaining === null ? null : daysRemaining < 0 ? 0 : Math.ceil(daysRemaining / 7);

  const note =
    daysRemaining !== null && daysRemaining < 0
      ? "A data-alvo passou. Atualize a data antes de interpretar a trajetória."
      : focusArea
        ? `Mantenha as metas semanais e use ${focusArea} como foco de diagnóstico/recuperação.`
        : "Mantenha as metas semanais; o foco por área aparece quando houver amostra.";

  return {
    providerId,
    targetDate,
    daysRemaining,
    weeksRemaining,
    weekStart: dateKey(weekStartDate),
    weekEnd: dateKey(new Date(weekEndDate.getTime() - DAY_MS)),
    elapsedWeekDays,
    metrics,
    rhythm,
    rhythmPct,
    confidence,
    reasons,
    areas,
    nextWeek: {
      questions: questionTarget,
      reviews: reviewTarget,
      essays: essayTarget,
      focusArea,
      note,
    },
    baseGoal,
  };
}
