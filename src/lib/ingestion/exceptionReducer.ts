import { assessSemanticFidelity, questionHasCompleteStructure } from "./semanticFidelity";
import type {
  IngestionJobResult,
  SelectiveFallbackReason,
  SemanticFidelityIssue,
  SemanticFidelityIssueCode,
} from "./types";

export type ExceptionRootCause =
  | "structure-incomplete"
  | "media-unbound"
  | "glyph-control"
  | "glyph-replacement"
  | "glyph-private-use"
  | "formula-ambiguity"
  | "layout-ambiguity"
  | "extractor-reported";

export type ExceptionFieldScope =
  | "statement"
  | "context"
  | "alternative"
  | "media"
  | "structure"
  | "page"
  | "global";

export type RepairTier =
  | "deterministic"
  | "alternate-parser"
  | "geometry"
  | "local-ocr"
  | "vision"
  | "llm"
  | "human";

export type RepairScope = "field" | "question" | "page" | "cluster" | "human";

export interface ExceptionObservation {
  id: string;
  fingerprint: string;
  providerId: string;
  sourceId: string;
  editionId: string;
  year: number;
  phase: string;
  variant?: string;
  importerVersion: string;
  questionNumber?: number;
  page?: number;
  reason: SelectiveFallbackReason;
  rootCause: ExceptionRootCause;
  fieldScope: ExceptionFieldScope;
  message: string;
}

export interface RepairStrategy {
  id: string;
  tier: RepairTier;
  costRank: number;
  scope: RepairScope;
  batchable: boolean;
  maxBatchSize: number;
  rootCauses: readonly ExceptionRootCause[];
  /** Repair is still untrusted and must re-enter canonical validation. */
  requiresRevalidation: true;
}

export interface RepairRouteStep {
  strategyId: string;
  tier: RepairTier;
  scope: RepairScope;
  batchable: boolean;
  estimatedBatches: number;
  costRank: number;
}

export interface ExceptionCluster {
  fingerprint: string;
  providerId: string;
  sourceId: string;
  rootCause: ExceptionRootCause;
  fieldScope: ExceptionFieldScope;
  messageSignature: string;
  observations: ExceptionObservation[];
  occurrenceCount: number;
  affectedEditions: number;
  affectedQuestions: number;
  affectedPages: number;
  repairRoute: RepairRouteStep[];
  /** Operational ordering only; it is not a confidence or correctness score. */
  priorityScore: number;
}

export interface ExceptionReductionMetrics {
  observations: number;
  clusters: number;
  affectedEditions: number;
  affectedQuestions: number;
  largestClusterQuestions: number;
  clustersStartingDeterministic: number;
  clustersStartingWithLocalOcrOrHigher: number;
  estimatedFirstPassBatches: number;
  rootCauseCounts: Partial<Record<ExceptionRootCause, number>>;
}

export interface ExceptionReductionPlan {
  clusters: ExceptionCluster[];
  metrics: ExceptionReductionMetrics;
}

const ROOT_CAUSE_BY_SEMANTIC_CODE: Record<SemanticFidelityIssueCode, ExceptionRootCause> = {
  "control-character": "glyph-control",
  "replacement-character": "glyph-replacement",
  "private-use-character": "glyph-private-use",
  "formula-ambiguity": "formula-ambiguity",
  "layout-ambiguity": "layout-ambiguity",
  "extractor-reported": "extractor-reported",
};

const EXPENSIVE_TIERS = new Set<RepairTier>(["local-ocr", "vision", "llm", "human"]);

export const DEFAULT_REPAIR_STRATEGIES: readonly RepairStrategy[] = [
  {
    id: "font-map-recovery",
    tier: "alternate-parser",
    costRank: 2,
    scope: "cluster",
    batchable: true,
    maxBatchSize: 1000,
    rootCauses: [
      "glyph-control",
      "glyph-replacement",
      "glyph-private-use",
      "formula-ambiguity",
    ],
    requiresRevalidation: true,
  },
  {
    id: "alternate-text-layout-parser",
    tier: "alternate-parser",
    costRank: 2,
    scope: "cluster",
    batchable: true,
    maxBatchSize: 1000,
    rootCauses: ["structure-incomplete", "layout-ambiguity", "extractor-reported"],
    requiresRevalidation: true,
  },
  {
    id: "geometry-boundary-recovery",
    tier: "geometry",
    costRank: 3,
    scope: "page",
    batchable: true,
    maxBatchSize: 50,
    rootCauses: ["structure-incomplete", "layout-ambiguity"],
    requiresRevalidation: true,
  },
  {
    id: "geometry-media-association",
    tier: "geometry",
    costRank: 3,
    scope: "page",
    batchable: true,
    maxBatchSize: 50,
    rootCauses: ["media-unbound"],
    requiresRevalidation: true,
  },
  {
    id: "local-ocr-region",
    tier: "local-ocr",
    costRank: 4,
    scope: "page",
    batchable: true,
    maxBatchSize: 24,
    rootCauses: [
      "structure-incomplete",
      "glyph-control",
      "glyph-replacement",
      "glyph-private-use",
      "formula-ambiguity",
      "layout-ambiguity",
      "extractor-reported",
    ],
    requiresRevalidation: true,
  },
  {
    id: "vision-region",
    tier: "vision",
    costRank: 5,
    scope: "page",
    batchable: true,
    maxBatchSize: 12,
    rootCauses: [
      "structure-incomplete",
      "media-unbound",
      "glyph-control",
      "glyph-replacement",
      "glyph-private-use",
      "formula-ambiguity",
      "layout-ambiguity",
      "extractor-reported",
    ],
    requiresRevalidation: true,
  },
  {
    id: "llm-structured-repair",
    tier: "llm",
    costRank: 6,
    scope: "question",
    batchable: true,
    maxBatchSize: 20,
    rootCauses: [
      "structure-incomplete",
      "glyph-control",
      "glyph-replacement",
      "glyph-private-use",
      "formula-ambiguity",
      "layout-ambiguity",
      "extractor-reported",
    ],
    requiresRevalidation: true,
  },
  {
    id: "human-review",
    tier: "human",
    costRank: 7,
    scope: "human",
    batchable: true,
    maxBatchSize: 100,
    rootCauses: [
      "structure-incomplete",
      "media-unbound",
      "glyph-control",
      "glyph-replacement",
      "glyph-private-use",
      "formula-ambiguity",
      "layout-ambiguity",
      "extractor-reported",
    ],
    requiresRevalidation: true,
  },
] as const;

function normalizeIdentityPart(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "default"
  );
}

/**
 * Makes recurrent extractor messages clusterable without using question/year
 * numbers as accidental identities. This is an operational signature, not a
 * cryptographic fingerprint.
 */
export function normalizeExceptionMessage(message: string): string {
  return message
    .normalize("NFC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{32,64}\b/gi, "<digest>")
    .replace(/\b\d+\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticFieldScope(issue: SemanticFidelityIssue): ExceptionFieldScope {
  if (issue.field === "statement") return "statement";
  if (issue.field === "context") return "context";
  if (issue.field?.startsWith("alternative:")) return "alternative";
  if (issue.page !== undefined) return "page";
  return "global";
}

function buildFingerprint(
  providerId: string,
  sourceId: string,
  rootCause: ExceptionRootCause,
  fieldScope: ExceptionFieldScope,
  message: string,
): string {
  return [
    normalizeIdentityPart(providerId),
    normalizeIdentityPart(sourceId),
    rootCause,
    fieldScope,
    normalizeExceptionMessage(message),
  ].join("|");
}

function observationId(
  fingerprint: string,
  editionId: string,
  questionNumber: number | undefined,
  page: number | undefined,
): string {
  return [fingerprint, normalizeIdentityPart(editionId), questionNumber ?? "*", page ?? "*"].join(
    "|",
  );
}

function makeObservation(
  job: IngestionJobResult & { stagedExam: NonNullable<IngestionJobResult["stagedExam"]> },
  input: {
    rootCause: ExceptionRootCause;
    fieldScope: ExceptionFieldScope;
    reason: SelectiveFallbackReason;
    message: string;
    questionNumber?: number;
    page?: number;
  },
): ExceptionObservation {
  const fingerprint = buildFingerprint(
    job.providerId,
    job.sourceId,
    input.rootCause,
    input.fieldScope,
    input.message,
  );
  return {
    id: observationId(fingerprint, job.editionId, input.questionNumber, input.page),
    fingerprint,
    providerId: job.providerId,
    sourceId: job.sourceId,
    editionId: job.editionId,
    year: job.year,
    phase: job.phase,
    variant: job.variant,
    importerVersion: job.stagedExam.raw.importerVersion,
    questionNumber: input.questionNumber,
    page: input.page,
    reason: input.reason,
    rootCause: input.rootCause,
    fieldScope: input.fieldScope,
    message: input.message,
  };
}

/** Convert one staged job into blocking exception observations. */
export function collectJobExceptionObservations(job: IngestionJobResult): ExceptionObservation[] {
  if (!job.stagedExam) return [];
  const stagedJob = job as IngestionJobResult & {
    stagedExam: NonNullable<IngestionJobResult["stagedExam"]>;
  };
  const observations: ExceptionObservation[] = [];
  const missingMedia = new Set(job.stagedExam.questionsMissingMedia);

  for (const question of job.stagedExam.questions) {
    if (!questionHasCompleteStructure(question, job.stagedExam.allowedLetters)) {
      observations.push(
        makeObservation(stagedJob, {
          rootCause: "structure-incomplete",
          fieldScope: "structure",
          reason: "incomplete-structure",
          message: "enunciado/alternativas não foram recuperados com a estrutura objetiva esperada",
          questionNumber: question.number,
          page: question.page,
        }),
      );
    }
    if (missingMedia.has(question.number)) {
      observations.push(
        makeObservation(stagedJob, {
          rootCause: "media-unbound",
          fieldScope: "media",
          reason: "missing-media",
          message: "questão depende de mídia ainda não associada",
          questionNumber: question.number,
          page: question.page,
        }),
      );
    }
  }

  const semanticIssues = assessSemanticFidelity({
    questions: job.stagedExam.questions,
    answerKey: job.stagedExam.raw.answerKey,
    questionsMissingMedia: job.stagedExam.questionsMissingMedia,
    semanticFidelityIssues: job.stagedExam.semanticFidelityIssues,
  });
  for (const issue of semanticIssues) {
    if (issue.severity === "warning") continue;
    observations.push(
      makeObservation(stagedJob, {
        rootCause: ROOT_CAUSE_BY_SEMANTIC_CODE[issue.code] ?? "extractor-reported",
        fieldScope: semanticFieldScope(issue),
        reason: "semantic-fidelity",
        message: issue.message,
        questionNumber: issue.questionNumber,
        page: issue.page,
      }),
    );
  }

  const deduped = new Map<string, ExceptionObservation>();
  for (const observation of observations) deduped.set(observation.id, observation);
  return [...deduped.values()];
}

function unitsForScope(
  cluster: Pick<ExceptionCluster, "occurrenceCount" | "affectedQuestions" | "affectedPages">,
  scope: RepairScope,
): number {
  if (scope === "cluster") return 1;
  if (scope === "page") return Math.max(1, cluster.affectedPages || cluster.affectedQuestions);
  if (scope === "question" || scope === "human") {
    return Math.max(1, cluster.affectedQuestions || cluster.occurrenceCount);
  }
  return Math.max(1, cluster.occurrenceCount);
}

export function routeRepairStrategies(
  cluster: Pick<ExceptionCluster, "rootCause" | "occurrenceCount" | "affectedQuestions" | "affectedPages">,
  strategies: readonly RepairStrategy[] = DEFAULT_REPAIR_STRATEGIES,
): RepairRouteStep[] {
  return strategies
    .filter((strategy) => strategy.rootCauses.includes(cluster.rootCause))
    .sort((a, b) => a.costRank - b.costRank || a.id.localeCompare(b.id))
    .map((strategy) => ({
      strategyId: strategy.id,
      tier: strategy.tier,
      scope: strategy.scope,
      batchable: strategy.batchable,
      estimatedBatches: Math.ceil(unitsForScope(cluster, strategy.scope) / strategy.maxBatchSize),
      costRank: strategy.costRank,
    }));
}

export function clusterExceptionObservations(
  observations: readonly ExceptionObservation[],
  strategies: readonly RepairStrategy[] = DEFAULT_REPAIR_STRATEGIES,
): ExceptionCluster[] {
  const groups = new Map<string, ExceptionObservation[]>();
  for (const observation of observations) {
    const group = groups.get(observation.fingerprint) ?? [];
    group.push(observation);
    groups.set(observation.fingerprint, group);
  }

  const clusters = [...groups.entries()].map(([fingerprint, group]) => {
    const first = group[0];
    const editionKeys = new Set(
      group.map(
        (item) =>
          `${item.providerId}:${item.sourceId}:${item.editionId}:${item.phase}:${item.variant ?? ""}`,
      ),
    );
    const questionKeys = new Set(
      group
        .filter((item) => item.questionNumber !== undefined)
        .map((item) => `${item.editionId}:${item.phase}:${item.variant ?? ""}:${item.questionNumber}`),
    );
    const pageKeys = new Set(
      group
        .filter((item) => item.page !== undefined)
        .map((item) => `${item.editionId}:${item.phase}:${item.variant ?? ""}:${item.page}`),
    );
    const base = {
      fingerprint,
      providerId: first.providerId,
      sourceId: first.sourceId,
      rootCause: first.rootCause,
      fieldScope: first.fieldScope,
      messageSignature: normalizeExceptionMessage(first.message),
      observations: [...group].sort(
        (a, b) => a.year - b.year || (a.questionNumber ?? 0) - (b.questionNumber ?? 0),
      ),
      occurrenceCount: group.length,
      affectedEditions: editionKeys.size,
      affectedQuestions: questionKeys.size,
      affectedPages: pageKeys.size,
    };
    const repairRoute = routeRepairStrategies(base, strategies);
    const firstCost = repairRoute[0]?.costRank ?? 8;
    const impact = Math.max(1, base.affectedQuestions || base.occurrenceCount);
    return {
      ...base,
      repairRoute,
      priorityScore: impact * Math.max(1, 9 - firstCost),
    } satisfies ExceptionCluster;
  });

  return clusters.sort(
    (a, b) =>
      b.priorityScore - a.priorityScore ||
      b.affectedQuestions - a.affectedQuestions ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
}

/**
 * Build a cross-edition plan. Clustering across jobs is the key scaling unit:
 * one parser/layout repair can remove hundreds of per-question exceptions.
 */
export function buildExceptionReductionPlan(
  jobs: readonly IngestionJobResult[],
  strategies: readonly RepairStrategy[] = DEFAULT_REPAIR_STRATEGIES,
): ExceptionReductionPlan {
  const observations = jobs.flatMap(collectJobExceptionObservations);
  const clusters = clusterExceptionObservations(observations, strategies);
  const affectedQuestions = new Set(
    observations
      .filter((item) => item.questionNumber !== undefined)
      .map(
        (item) =>
          `${item.providerId}:${item.sourceId}:${item.editionId}:${item.phase}:${item.variant ?? ""}:${item.questionNumber}`,
      ),
  );
  const affectedEditions = new Set(
    observations.map(
      (item) =>
        `${item.providerId}:${item.sourceId}:${item.editionId}:${item.phase}:${item.variant ?? ""}`,
    ),
  );
  const rootCauseCounts: Partial<Record<ExceptionRootCause, number>> = {};
  for (const cluster of clusters) {
    rootCauseCounts[cluster.rootCause] =
      (rootCauseCounts[cluster.rootCause] ?? 0) + cluster.affectedQuestions;
  }

  return {
    clusters,
    metrics: {
      observations: observations.length,
      clusters: clusters.length,
      affectedEditions: affectedEditions.size,
      affectedQuestions: affectedQuestions.size,
      largestClusterQuestions: Math.max(0, ...clusters.map((cluster) => cluster.affectedQuestions)),
      clustersStartingDeterministic: clusters.filter(
        (cluster) => cluster.repairRoute[0]?.tier === "deterministic",
      ).length,
      clustersStartingWithLocalOcrOrHigher: clusters.filter((cluster) => {
        const first = cluster.repairRoute[0];
        return first ? EXPENSIVE_TIERS.has(first.tier) : true;
      }).length,
      estimatedFirstPassBatches: clusters.reduce(
        (total, cluster) => total + (cluster.repairRoute[0]?.estimatedBatches ?? 1),
        0,
      ),
      rootCauseCounts,
    },
  };
}
