import { readinessSnapshot } from "./study-intelligence";
import {
  completeExperiment,
  completeStudyDecision,
  recordStudyFeedback,
} from "./study-learning";
import type { DB, StudyFeedbackValue } from "./types";
import { resolveProviderId } from "../providers/registry";

/**
 * Fecha todos os registros ligados à tentativa depois que correção/SRS/sessões
 * já foram atualizados. Sem decisão registrada é deliberadamente no-op.
 */
export function finalizeStudyIntelligenceForAttempt(db: DB, attemptId: string): void {
  const attempt = db.attempts.find((item) => item.id === attemptId);
  if (!attempt?.result) return;
  const records = Object.values(db.studyIntelligence?.decisions ?? {}).filter(
    (record) => record.attemptId === attemptId,
  );
  if (!records.length) return;

  const providerId = resolveProviderId(attempt.providerId);
  const readinessAfter = readinessSnapshot(db, providerId).score;
  const accuracyAfter = attempt.result.total
    ? Math.round((attempt.result.correct / attempt.result.total) * 100)
    : 0;

  for (const record of records) {
    completeStudyDecision(db, record.id, { readinessAfter, accuracyAfter });
    const experiment = Object.values(db.studyIntelligence?.experiments ?? {}).find(
      (item) => item.decisionId === record.id,
    );
    if (!experiment) continue;
    completeExperiment(db, experiment.id, {
      completedAt: attempt.finishedAt ?? new Date().toISOString(),
      readinessDelta:
        typeof record.readinessBefore === "number"
          ? readinessAfter - record.readinessBefore
          : null,
      accuracy: accuracyAfter,
      feedback: record.feedback?.usefulness ?? experiment.feedback ?? null,
    });
  }
}

/** Feedback posterior também é refletido no braço experimental correspondente. */
export function recordFeedbackForDecision(
  db: DB,
  decisionId: string,
  usefulness: StudyFeedbackValue,
  at: string,
): void {
  const decision = recordStudyFeedback(db, decisionId, usefulness, at);
  if (!decision) return;
  for (const experiment of Object.values(db.studyIntelligence?.experiments ?? {})) {
    if (experiment.decisionId === decisionId) experiment.feedback = usefulness;
  }
}
