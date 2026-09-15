import { DEFAULT_PROVIDER_ID, resolveProviderId, sameProvider } from "../providers/registry";
import { adaptiveCandidates } from "./adaptive";
import {
  buildObjectiveAdaptiveSelection,
  type AdaptiveObjective,
  type AdaptivePersonalization,
} from "./adaptive-objectives";
import { classifyContent, questionKey } from "./classify";
import { evidenceForContent, type EvidenceLevel } from "./study-intelligence";
import type { DB, Question } from "./types";

export type StudyQueueKind = "review" | "retry" | "adaptive";

export interface StudyQueueItem {
  kind: StudyQueueKind;
  providerId: string;
  questionKey: string;
  question: Question;
  content: string;
  score: number;
  confidence: EvidenceLevel;
  reasons: string[];
  sourceScore: number;
}

const KIND_BASE_SCORE: Record<StudyQueueKind, number> = {
  review: 3000,
  retry: 2000,
  adaptive: 1000,
};

function loadedQuestionsForProvider(all: Question[], providerId: string): Map<string, Question> {
  return new Map(
    all
      .filter((question) => sameProvider(question.providerId, providerId))
      .map((question) => [questionKey(question), question] as const),
  );
}

function confidenceFor(
  db: DB,
  content: string,
  providerId: string,
  now: Date,
): EvidenceLevel {
  return evidenceForContent(db, content, providerId, now)?.confidence ?? "baixa";
}

/**
 * Fila única do estudo para um banco já carregado. Ela não busca nem inventa
 * questões: só ordena identidades que realmente existem no `all` da prova
 * ativa. A prioridade estrutural permanece retenção → erro → avanço adaptativo.
 */
export function buildStudyQueue(
  db: DB,
  all: Question[],
  providerId: string = DEFAULT_PROVIDER_ID,
  objective: AdaptiveObjective = "balanced",
  limit = 40,
  now: Date = new Date(),
  personalization: AdaptivePersonalization = {},
): StudyQueueItem[] {
  const scoped = resolveProviderId(providerId);
  const byKey = loadedQuestionsForProvider(all, scoped);
  const nowMs = now.getTime();
  const candidates: StudyQueueItem[] = [];

  for (const [key, entry] of Object.entries(db.srs)) {
    if (!sameProvider(entry.providerId, scoped)) continue;
    const dueMs = +new Date(entry.due);
    if (!Number.isFinite(dueMs) || dueMs > nowMs) continue;
    const question = byKey.get(key);
    if (!question) continue;
    const content = entry.content?.trim() || classifyContent(question);
    const overdueDays = Math.max(0, (nowMs - dueMs) / 86400000);
    const sourceScore = Math.min(100, 40 + overdueDays * 3 + (entry.lastResult === "wrong" ? 20 : 0));
    candidates.push({
      kind: "review",
      providerId: scoped,
      questionKey: key,
      question,
      content,
      score: KIND_BASE_SCORE.review + sourceScore,
      sourceScore,
      confidence: confidenceFor(db, content, scoped, now),
      reasons: [
        "Revisão vencida: retenção vem antes de volume novo.",
        ...(entry.lastResult === "wrong" ? ["O último resultado registrado foi erro."] : []),
      ],
    });
  }

  for (const retry of adaptiveCandidates(db, scoped)) {
    const question = byKey.get(retry.key);
    if (!question) continue;
    candidates.push({
      kind: "retry",
      providerId: scoped,
      questionKey: retry.key,
      question,
      content: retry.content,
      score: KIND_BASE_SCORE.retry + retry.score,
      sourceScore: retry.score,
      confidence: confidenceFor(db, retry.content, scoped, now),
      reasons: retry.reasons,
    });
  }

  const adaptiveLimit = Math.min(all.length, Math.max(Math.max(1, limit) * 2, 40));
  for (const item of buildObjectiveAdaptiveSelection(
    db,
    [...byKey.values()],
    adaptiveLimit,
    scoped,
    objective,
    now,
    personalization,
  )) {
    candidates.push({
      kind: "adaptive",
      providerId: scoped,
      questionKey: item.decision.key,
      question: item.question,
      content: item.decision.content,
      score: KIND_BASE_SCORE.adaptive + item.decision.score,
      sourceScore: item.decision.score,
      confidence: confidenceFor(db, item.decision.content, scoped, now),
      reasons: [item.decision.objectiveReason, ...item.decision.reasons],
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.questionKey.localeCompare(b.questionKey));

  const deduped: StudyQueueItem[] = [];
  const seen = new Set<string>();
  for (const item of candidates) {
    if (seen.has(item.questionKey)) continue;
    seen.add(item.questionKey);
    deduped.push(item);
    if (deduped.length >= Math.max(0, limit)) break;
  }
  return deduped;
}
