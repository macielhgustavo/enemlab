import { DEFAULT_PROVIDER_ID, resolveProviderId } from "../providers/registry";
import { adaptiveDecision, buildAdaptiveSelection, type AdaptiveDecision, type AdaptiveScoreComponents, type AdaptiveSelectionItem } from "./adaptive";
import { masteryStats, officialRowsOf } from "./stats";
import type { DB, Question, StudyObjectiveId, StudySignalId } from "./types";

export type AdaptiveObjective = StudyObjectiveId;
export type AdaptivePersonalization = Partial<Record<StudySignalId, number>>;

export interface ObjectiveProfile {
  id: AdaptiveObjective;
  label: string;
  description: string;
  weights: Record<keyof AdaptiveScoreComponents, number>;
}

export const ADAPTIVE_OBJECTIVES: Record<AdaptiveObjective, ObjectiveProfile> = {
  balanced: {
    id: "balanced",
    label: "Balanceado",
    description: "Mantém a heurística histórica: retenção, fraqueza, amostra, recência e novidade.",
    weights: { weakness: 1, sample: 1, overdueReview: 1, novelty: 1, spacing: 1, difficulty: 1, tieBreak: 1 },
  },
  recovery: {
    id: "recovery",
    label: "Recuperação",
    description: "Puxa retenção vencida e conteúdos frágeis para cima sem abandonar diversidade.",
    weights: { weakness: 1.25, sample: 0.7, overdueReview: 1.35, novelty: 0.55, spacing: 1.2, difficulty: 1, tieBreak: 1 },
  },
  coverage: {
    id: "coverage",
    label: "Cobertura",
    description: "Prefere conteúdo pouco medido e questões inéditas para reduzir zonas desconhecidas.",
    weights: { weakness: 0.55, sample: 1.45, overdueReview: 0.55, novelty: 1.8, spacing: 0.7, difficulty: 0.8, tieBreak: 1 },
  },
  exam: {
    id: "exam",
    label: "Execução de prova",
    description: "Reduz exploração e aproxima a fila de um treino de execução com sinais já conhecidos.",
    weights: { weakness: 1, sample: 0.6, overdueReview: 1, novelty: 0.7, spacing: 1, difficulty: 0.75, tieBreak: 1 },
  },
  gain: {
    id: "gain",
    label: "Maior ganho esperado",
    description: "Combina fraqueza e incerteza para priorizar onde uma questão tende a informar e corrigir mais.",
    weights: { weakness: 1.15, sample: 1.15, overdueReview: 1.05, novelty: 0.9, spacing: 1.05, difficulty: 0.9, tieBreak: 1 },
  },
};

export interface ObjectiveAdaptiveDecision extends AdaptiveDecision {
  objective: AdaptiveObjective;
  baseScore: number;
  weightedComponents: AdaptiveScoreComponents;
  objectiveReason: string;
}

export interface ObjectiveAdaptiveSelectionItem extends Omit<AdaptiveSelectionItem, "decision"> {
  decision: ObjectiveAdaptiveDecision;
}

function personalizationMultiplier(
  key: keyof AdaptiveScoreComponents,
  personalization: AdaptivePersonalization,
): number {
  if (key === "tieBreak") return 1;
  const value = personalization[key as StudySignalId];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1.1, Math.max(0.9, value))
    : 1;
}

function weightedDecision(
  base: AdaptiveDecision,
  objective: AdaptiveObjective,
  personalization: AdaptivePersonalization = {},
): ObjectiveAdaptiveDecision {
  const profile = ADAPTIVE_OBJECTIVES[objective];
  const weightedComponents = Object.fromEntries(
    (Object.entries(base.components) as Array<[keyof AdaptiveScoreComponents, number]>).map(([key, value]) => [
      key,
      value * profile.weights[key] * personalizationMultiplier(key, personalization),
    ]),
  ) as unknown as AdaptiveScoreComponents;
  const score = Object.values(weightedComponents).reduce((sum, value) => sum + value, 0);
  return {
    ...base,
    objective,
    baseScore: base.score,
    weightedComponents,
    score,
    objectiveReason: profile.description,
  };
}

/**
 * O modo balanceado sem feedback delega à função histórica para garantir
 * exatamente a mesma fila. Personalização só existe depois de evidência
 * explícita e é limitada a ±10% por sinal.
 */
export function buildObjectiveAdaptiveSelection(
  db: DB,
  all: Question[],
  n = 15,
  providerId: string = DEFAULT_PROVIDER_ID,
  objective: AdaptiveObjective = "balanced",
  now: Date = new Date(),
  personalization: AdaptivePersonalization = {},
): ObjectiveAdaptiveSelectionItem[] {
  if (objective === "balanced" && Object.keys(personalization).length === 0) {
    return buildAdaptiveSelection(db, all, n, providerId, now).map((item) => ({
      question: item.question,
      decision: weightedDecision(item.decision, "balanced"),
    }));
  }

  const scopedProviderId = resolveProviderId(providerId);
  const stats = masteryStats(db, scopedProviderId);
  const seen = new Set(officialRowsOf(db, scopedProviderId).map((row) => row.key));
  const ranked = all
    .map((question) => ({
      question,
      decision: weightedDecision(
        adaptiveDecision(db, question, stats, seen, now),
        objective,
        personalization,
      ),
    }))
    .sort((a, b) => b.decision.score - a.decision.score || a.decision.key.localeCompare(b.decision.key));

  const chosen: ObjectiveAdaptiveSelectionItem[] = [];
  const perContent: Record<string, number> = {};
  const capPerContent = Math.max(3, Math.ceil(n * 0.3));
  for (const item of ranked) {
    const content = item.decision.content;
    if ((perContent[content] || 0) >= capPerContent) continue;
    chosen.push(item);
    perContent[content] = (perContent[content] || 0) + 1;
    if (chosen.length >= n) break;
  }
  return chosen;
}

export function buildObjectiveAdaptiveQuestions(
  db: DB,
  all: Question[],
  n = 15,
  providerId: string = DEFAULT_PROVIDER_ID,
  objective: AdaptiveObjective = "balanced",
  now: Date = new Date(),
  personalization: AdaptivePersonalization = {},
): Question[] {
  return buildObjectiveAdaptiveSelection(db, all, n, providerId, objective, now, personalization).map((item) => item.question);
}
