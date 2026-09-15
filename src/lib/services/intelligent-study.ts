import { uid } from "../format";
import type { AdaptiveScoreComponents } from "../domain/adaptive";
import {
  buildObjectiveAdaptiveSelection,
  type AdaptiveObjective,
} from "../domain/adaptive-objectives";
import { questionKey } from "../domain/classify";
import { buildDiagnosticSelection, type DiagnosticSelection } from "../domain/diagnostic";
import {
  coverageSnapshot,
  expectedContentsFromQuestions,
  readinessSnapshot,
} from "../domain/study-intelligence";
import { finalizePendingStudyIntelligence } from "../domain/study-learning-finalize";
import {
  assignExperimentVariant,
  feedbackWeightMultipliers,
  providerStudyConfig,
  recordExperiment,
  recordStudyDecision,
  setProviderStudyConfig,
  temporalBlockSize,
  type DecisionRecordInput,
} from "../domain/study-learning";
import { studyGoalProgress, type GoalProgress } from "../domain/study-goal";
import { buildStudyQueue, type StudyQueueItem } from "../domain/study-queue";
import { officialRowsOf } from "../domain/stats";
import type {
  Attempt,
  DB,
  Language,
  Question,
  StudyExperimentRecord,
  StudyProviderConfig,
  StudySignalId,
} from "../domain/types";
import { getProvider, resolveProviderId } from "../providers";
import { questionsFor } from "../providers/access";
import { attemptFromQuestions } from "./attempts";

interface EditionRef {
  id?: string;
  year: number;
}

export interface IntelligencePool {
  providerId: string;
  year: number;
  lang: Language;
  questions: Question[];
  expectedContents: string[];
}

export interface IntelligencePreview {
  providerId: string;
  objective: AdaptiveObjective;
  poolSize: number;
  expectedContents: string[];
  queue: StudyQueueItem[];
  diagnostic: DiagnosticSelection;
  coverage: ReturnType<typeof coverageSnapshot>;
  readiness: ReturnType<typeof readinessSnapshot>;
  goal: GoalProgress;
}

export type IntelligentStudyKind = "objective" | "queue" | "diagnostic";

export interface IntelligentStudyOptions {
  kind: IntelligentStudyKind;
  objective?: AdaptiveObjective;
  n?: number;
}

export interface IntelligentStudyLaunch {
  kind: IntelligentStudyKind;
  attempt: Attempt;
  objective: AdaptiveObjective;
  decision: DecisionRecordInput;
  experiment?: Omit<
    StudyExperimentRecord,
    "completedAt" | "readinessDelta" | "accuracy" | "feedback"
  >;
  variant: string | null;
  summary: string;
}

function providerLanguage(providerId: string): Language {
  const language = getProvider(providerId).metadata.languages[0]?.id;
  return language === "espanhol" ? "espanhol" : "ingles";
}

function orderedEditions(providerId: string): EditionRef[] {
  const metadata = getProvider(providerId).metadata;
  if (metadata.editions?.length) {
    return metadata.editions
      .map((edition, index) => ({ id: edition.id, year: edition.year, index }))
      .sort((a, b) => b.year - a.year || a.index - b.index)
      .map(({ id, year }) => ({ id, year }));
  }
  return metadata.years.map((year) => ({ year }));
}

/**
 * Banco auditado usado pelas novas decisões. Só usa providers já registrados
 * e a mesma função `questionsFor()` do restante do produto; não inventa
 * identidade nem cria um caminho paralelo de gabarito.
 */
export async function loadIntelligencePool(
  providerId: string,
  editionLimit = 3,
): Promise<IntelligencePool> {
  const scoped = resolveProviderId(providerId);
  const lang = providerLanguage(scoped);
  const editions = orderedEditions(scoped).slice(0, Math.max(1, editionLimit));
  if (!editions.length) throw new Error("Nenhuma edição disponível para esta prova.");

  const byKey = new Map<string, Question>();
  for (const edition of editions) {
    const batch = await questionsFor(scoped, {
      year: edition.year,
      editionId: edition.id,
      language: lang,
    });
    for (const question of batch) byKey.set(questionKey(question), question);
  }

  const questions = [...byKey.values()];
  if (!questions.length) throw new Error("Nenhuma questão disponível para esta prova.");
  return {
    providerId: scoped,
    year: questions[0]?.year ?? editions[0].year,
    lang,
    questions,
    expectedContents: expectedContentsFromQuestions(questions),
  };
}

function averageQuestionMinutes(db: DB, providerId: string): number {
  const rows = officialRowsOf(db, providerId)
    .filter((row) => row.timeSec > 0)
    .slice(-40);
  if (!rows.length) return 3.2;
  return Math.max(0.5, rows.reduce((sum, row) => sum + row.timeSec, 0) / rows.length / 60);
}

function dominantSignal(weighted: AdaptiveScoreComponents): StudySignalId | null {
  const allowed: StudySignalId[] = [
    "weakness",
    "sample",
    "overdueReview",
    "novelty",
    "spacing",
    "difficulty",
  ];
  return allowed
    .map((signal) => ({ signal, value: Math.abs(weighted[signal]) }))
    .sort((a, b) => b.value - a.value)[0]?.signal ?? null;
}

function configuredGoal(db: DB, providerId: string): StudyProviderConfig {
  return providerStudyConfig(db, providerId);
}

export async function loadIntelligencePreview(
  db: DB,
  providerId: string,
  objective?: AdaptiveObjective,
  now = new Date(),
): Promise<IntelligencePreview> {
  const pool = await loadIntelligencePool(providerId, 3);
  const config = configuredGoal(db, pool.providerId);
  const selectedObjective = objective ?? config.objective ?? "balanced";
  const personalization = feedbackWeightMultipliers(db, pool.providerId, selectedObjective);
  const queue = buildStudyQueue(
    db,
    pool.questions,
    pool.providerId,
    selectedObjective,
    40,
    now,
    personalization,
  );
  const diagnostic = buildDiagnosticSelection(db, pool.questions, pool.providerId, 25, now);
  const coverage = coverageSnapshot(db, pool.providerId, pool.expectedContents);
  const readiness = readinessSnapshot(db, pool.providerId, pool.expectedContents);
  const goal = studyGoalProgress(
    db,
    { providerId: pool.providerId, ...config },
    pool.expectedContents,
    now,
  );
  return {
    providerId: pool.providerId,
    objective: selectedObjective,
    poolSize: pool.questions.length,
    expectedContents: pool.expectedContents,
    queue,
    diagnostic,
    coverage,
    readiness,
    goal,
  };
}

export async function buildIntelligentStudyLaunch(
  db: DB,
  providerId: string,
  options: IntelligentStudyOptions,
  now = new Date(),
): Promise<IntelligentStudyLaunch> {
  const pool = await loadIntelligencePool(providerId, 3);
  const config = configuredGoal(db, pool.providerId);
  const objective = options.objective ?? config.objective ?? "balanced";
  const decisionId = uid();
  const isExperiment = options.kind !== "diagnostic";
  const experimentId = isExperiment ? "adaptive-feedback-v1" : null;
  const variant = experimentId
    ? assignExperimentVariant(experimentId, decisionId, ["base", "feedback"])
    : null;
  const personalization = variant === "feedback"
    ? feedbackWeightMultipliers(db, pool.providerId, objective)
    : {};

  const baseN = Math.max(1, Math.round(options.n ?? (options.kind === "diagnostic" ? 25 : 15)));
  const adjustedN = options.kind === "diagnostic"
    ? baseN
    : temporalBlockSize(db, pool.providerId, baseN, averageQuestionMinutes(db, pool.providerId));

  let questions: Question[] = [];
  let topContent: string | null = null;
  let topReasons: string[] = [];
  let signal: StudySignalId | null = null;
  let summary = "";

  if (options.kind === "diagnostic") {
    const diagnostic = buildDiagnosticSelection(
      db,
      pool.questions,
      pool.providerId,
      adjustedN,
      now,
    );
    questions = diagnostic.selected.map((item) => item.question);
    topContent = diagnostic.selected[0]?.content ?? null;
    topReasons = diagnostic.selected[0]?.reasons ?? [];
    summary = diagnostic.note;
  } else if (options.kind === "queue") {
    const queue = buildStudyQueue(
      db,
      pool.questions,
      pool.providerId,
      objective,
      adjustedN,
      now,
      personalization,
    );
    questions = queue.map((item) => item.question);
    topContent = queue[0]?.content ?? null;
    topReasons = queue[0]?.reasons ?? [];
    summary = `Fila única: ${queue.length} questão(ões), sem duplicar retenção, erros e avanço adaptativo.`;
  } else {
    const selection = buildObjectiveAdaptiveSelection(
      db,
      pool.questions,
      adjustedN,
      pool.providerId,
      objective,
      now,
      personalization,
    );
    questions = selection.map((item) => item.question);
    topContent = selection[0]?.decision.content ?? null;
    topReasons = selection[0]
      ? [selection[0].decision.objectiveReason, ...selection[0].decision.reasons]
      : [];
    signal = selection[0]
      ? dominantSignal(selection[0].decision.weightedComponents)
      : null;
    summary = selection[0]?.decision.objectiveReason ?? "Treino adaptativo por objetivo.";
  }

  if (!questions.length) throw new Error("Não encontrei questões para esta decisão de estudo.");
  const attempt = attemptFromQuestions(
    questions[0]?.year ?? pool.year,
    pool.lang,
    questions,
    "adaptive",
    pool.providerId,
  );
  const readinessBefore = readinessSnapshot(
    db,
    pool.providerId,
    pool.expectedContents,
  ).score;
  const decision: DecisionRecordInput = {
    id: decisionId,
    attemptId: attempt.id,
    providerId: pool.providerId,
    at: now.toISOString(),
    objective: options.kind === "diagnostic" ? "coverage" : objective,
    questionKeys: attempt.questionRefs.map((ref) => ref.questionKey).filter((key): key is string => Boolean(key)),
    topContent,
    topReasons,
    dominantSignal: signal,
    readinessBefore,
    experimentId,
    experimentVariant: variant,
  };
  const experiment = experimentId && variant
    ? {
        id: `${decisionId}|${experimentId}`,
        experimentId,
        variant,
        providerId: pool.providerId,
        decisionId,
        at: now.toISOString(),
      }
    : undefined;

  return {
    kind: options.kind,
    attempt,
    objective,
    decision,
    experiment,
    variant,
    summary,
  };
}

/** Persiste tentativa + decisão + experimento na mesma mutação do store. */
export function persistIntelligentStudyLaunch(
  db: DB,
  launch: IntelligentStudyLaunch,
): void {
  finalizePendingStudyIntelligence(db, launch.attempt.providerId);
  db.attempts.unshift(launch.attempt);
  db.lastOpened = launch.attempt.id;
  recordStudyDecision(db, launch.decision);
  if (launch.experiment) recordExperiment(db, launch.experiment);
  setProviderStudyConfig(db, launch.attempt.providerId ?? "enem", {
    objective: launch.objective,
  });
}
