import { DEFAULT_PROVIDER_ID, resolveProviderId } from "../providers/registry";
import { temporalProfile } from "./study-intelligence";
import type {
  DB,
  StudyDecisionRecord,
  StudyExperimentRecord,
  StudyFeedbackValue,
  StudyIntelligenceState,
  StudyObjectiveId,
  StudyProviderConfig,
  StudySignalId,
} from "./types";

export interface DecisionRecordInput {
  id: string;
  attemptId?: string;
  providerId?: string;
  at: string;
  objective: StudyObjectiveId;
  questionKeys: string[];
  topContent?: string | null;
  topReasons?: string[];
  dominantSignal?: StudySignalId | null;
  readinessBefore?: number | null;
  experimentId?: string | null;
  experimentVariant?: string | null;
}

export interface DecisionOutcome {
  readinessAfter?: number | null;
  accuracyAfter?: number | null;
}

export interface ExperimentVariantSummary {
  variant: string;
  n: number;
  avgReadinessDelta: number | null;
  avgAccuracy: number | null;
  helpfulRate: number | null;
}

export interface ExperimentSummary {
  experimentId: string;
  status: "insufficient" | "directional";
  variants: ExperimentVariantSummary[];
  note: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function emptyStudyIntelligence(): StudyIntelligenceState {
  return { decisions: {}, experiments: {}, providerConfig: {} };
}

export function ensureStudyIntelligence(db: DB): StudyIntelligenceState {
  const state = (db.studyIntelligence ??= emptyStudyIntelligence());
  state.decisions ||= {};
  state.experiments ||= {};
  state.providerConfig ||= {};
  return state;
}

export function providerStudyConfig(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
): StudyProviderConfig {
  const scoped = resolveProviderId(providerId);
  return { ...(db.studyIntelligence?.providerConfig?.[scoped] ?? {}) };
}

export function setProviderStudyConfig(
  db: DB,
  providerId: string,
  patch: Partial<StudyProviderConfig>,
): StudyProviderConfig {
  const scoped = resolveProviderId(providerId);
  const state = ensureStudyIntelligence(db);
  const current = state.providerConfig[scoped] ?? {};
  const next: StudyProviderConfig = { ...current, ...patch };
  state.providerConfig[scoped] = next;
  return { ...next };
}

export function recordStudyDecision(db: DB, input: DecisionRecordInput): StudyDecisionRecord {
  const providerId = resolveProviderId(input.providerId);
  const record: StudyDecisionRecord = {
    id: input.id,
    attemptId: input.attemptId,
    providerId,
    at: input.at,
    objective: input.objective,
    questionKeys: [...new Set(input.questionKeys)],
    topContent: input.topContent ?? null,
    topReasons: [...new Set(input.topReasons ?? [])].slice(0, 8),
    dominantSignal: input.dominantSignal ?? null,
    readinessBefore: input.readinessBefore ?? null,
    readinessAfter: null,
    accuracyAfter: null,
    experimentId: input.experimentId ?? null,
    experimentVariant: input.experimentVariant ?? null,
  };
  ensureStudyIntelligence(db).decisions[record.id] = record;
  return record;
}

export function completeStudyDecision(
  db: DB,
  decisionId: string,
  outcome: DecisionOutcome,
): StudyDecisionRecord | null {
  const record = db.studyIntelligence?.decisions?.[decisionId];
  if (!record) return null;
  if (Number.isFinite(outcome.readinessAfter)) record.readinessAfter = Number(outcome.readinessAfter);
  if (Number.isFinite(outcome.accuracyAfter)) record.accuracyAfter = clamp(Number(outcome.accuracyAfter), 0, 100);
  return record;
}

export function recordStudyFeedback(
  db: DB,
  decisionId: string,
  usefulness: StudyFeedbackValue,
  at: string,
): StudyDecisionRecord | null {
  const record = db.studyIntelligence?.decisions?.[decisionId];
  if (!record) return null;
  record.feedback = { usefulness, at };
  return record;
}

export function decisionHistory(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
  limit = 50,
): StudyDecisionRecord[] {
  const scoped = resolveProviderId(providerId);
  return Object.values(db.studyIntelligence?.decisions ?? {})
    .filter((record) => resolveProviderId(record.providerId) === scoped)
    .sort((a, b) => +new Date(b.at) - +new Date(a.at) || b.id.localeCompare(a.id))
    .slice(0, Math.max(0, limit));
}

function feedbackValue(value: StudyFeedbackValue): number {
  return value === "helpful" ? 1 : value === "not_helpful" ? -1 : 0;
}

/**
 * Personalização conservadora: um sinal só muda de peso depois de 3 feedbacks
 * no mesmo objetivo e nunca passa de ±10%. Um clique isolado não muda o motor.
 */
export function feedbackWeightMultipliers(
  db: DB,
  providerId: string,
  objective: StudyObjectiveId,
): Partial<Record<StudySignalId, number>> {
  const scoped = resolveProviderId(providerId);
  const grouped = new Map<StudySignalId, number[]>();
  for (const record of Object.values(db.studyIntelligence?.decisions ?? {})) {
    if (resolveProviderId(record.providerId) !== scoped) continue;
    if (record.objective !== objective || !record.dominantSignal || !record.feedback) continue;
    const values = grouped.get(record.dominantSignal) ?? [];
    values.push(feedbackValue(record.feedback.usefulness));
    grouped.set(record.dominantSignal, values);
  }

  const out: Partial<Record<StudySignalId, number>> = {};
  for (const [signal, values] of grouped) {
    if (values.length < 3) continue;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    out[signal] = Math.round(clamp(1 + mean * 0.1, 0.9, 1.1) * 1000) / 1000;
  }
  return out;
}

/** Nunca aumenta a carga; apenas encurta quando há padrão repetido de fadiga. */
export function temporalBlockSize(
  db: DB,
  providerId: string,
  baseQuestions: number,
  avgQuestionMinutes: number,
): number {
  const base = Math.max(1, Math.round(baseQuestions));
  const profile = temporalProfile(db, providerId);
  if (profile.fatiguedAttempts < 2 || !profile.fatigueThresholdMinutes || avgQuestionMinutes <= 0) {
    return base;
  }
  const safeWindow = profile.fatigueThresholdMinutes * 0.85;
  const evidenceBound = Math.max(5, Math.floor(safeWindow / avgQuestionMinutes));
  return Math.min(base, evidenceBound);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A/B determinístico por decisão; não depende de cookie, conta ou backend. */
export function assignExperimentVariant(
  experimentId: string,
  decisionId: string,
  variants: string[],
): string | null {
  const valid = [...new Set(variants.map((variant) => variant.trim()).filter(Boolean))];
  if (!valid.length) return null;
  return valid[stableHash(`${experimentId}|${decisionId}`) % valid.length];
}

export function recordExperiment(
  db: DB,
  input: Omit<StudyExperimentRecord, "completedAt" | "readinessDelta" | "accuracy" | "feedback">,
): StudyExperimentRecord {
  const record: StudyExperimentRecord = {
    ...input,
    providerId: resolveProviderId(input.providerId),
    completedAt: null,
    readinessDelta: null,
    accuracy: null,
    feedback: null,
  };
  ensureStudyIntelligence(db).experiments[record.id] = record;
  return record;
}

export function completeExperiment(
  db: DB,
  recordId: string,
  outcome: {
    completedAt: string;
    readinessDelta?: number | null;
    accuracy?: number | null;
    feedback?: StudyFeedbackValue | null;
  },
): StudyExperimentRecord | null {
  const record = db.studyIntelligence?.experiments?.[recordId];
  if (!record) return null;
  record.completedAt = outcome.completedAt;
  record.readinessDelta = Number.isFinite(outcome.readinessDelta) ? Number(outcome.readinessDelta) : null;
  record.accuracy = Number.isFinite(outcome.accuracy) ? clamp(Number(outcome.accuracy), 0, 100) : null;
  record.feedback = outcome.feedback ?? null;
  return record;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

/**
 * Resultado exploratório de experimento. Com poucos usuários não há alegação
 * de significância estatística; mesmo após 5 por braço o rótulo é direcional.
 */
export function experimentSummary(db: DB, experimentId: string): ExperimentSummary {
  const rows = Object.values(db.studyIntelligence?.experiments ?? {}).filter(
    (record) => record.experimentId === experimentId && record.completedAt,
  );
  const variants = [...new Set(rows.map((record) => record.variant))].sort();
  const summaries = variants.map((variant) => {
    const group = rows.filter((record) => record.variant === variant);
    const readiness = group.map((record) => record.readinessDelta).filter((value): value is number => typeof value === "number");
    const accuracy = group.map((record) => record.accuracy).filter((value): value is number => typeof value === "number");
    const rated = group.filter((record) => record.feedback);
    const helpfulRate = rated.length
      ? Math.round((rated.filter((record) => record.feedback === "helpful").length / rated.length) * 100)
      : null;
    return {
      variant,
      n: group.length,
      avgReadinessDelta: average(readiness),
      avgAccuracy: average(accuracy),
      helpfulRate,
    };
  });
  const status: ExperimentSummary["status"] = summaries.length >= 2 && summaries.every((summary) => summary.n >= 5)
    ? "directional"
    : "insufficient";
  return {
    experimentId,
    status,
    variants: summaries,
    note: status === "directional"
      ? "Comparação direcional interna; não implica significância estatística nem causalidade."
      : "Amostra insuficiente: aguarde pelo menos 5 tentativas concluídas por variante.",
  };
}
