import {
  acceptEdition,
  type NormalizedExamEdition,
  type ValidationLevel,
} from "../sources/ingestion";
import type { IngestionJobResult } from "./types";

export type ReviewDisposition = "approved" | "rejected" | "needs-changes";
export type ApprovedValidationLevel = Extract<ValidationLevel, "reviewed" | "verified">;

export interface IngestionReviewDecision {
  jobKey: string;
  contentFingerprint: string;
  disposition: ReviewDisposition;
  validationLevel?: ApprovedValidationLevel;
  reviewer: string;
  reviewedAt: string;
  notes?: string;
}

export interface ReviewDecisionStore {
  get(jobKey: string): Promise<IngestionReviewDecision | null>;
  set(decision: IngestionReviewDecision): Promise<void>;
}

export interface ReviewedCatalogHandoff {
  jobKey: string;
  variant?: string;
  decision: IngestionReviewDecision;
  edition: NormalizedExamEdition;
}

export class InMemoryReviewDecisionStore implements ReviewDecisionStore {
  private readonly decisions = new Map<string, IngestionReviewDecision>();

  async get(jobKey: string): Promise<IngestionReviewDecision | null> {
    const value = this.decisions.get(jobKey);
    return value ? { ...value } : null;
  }

  async set(decision: IngestionReviewDecision): Promise<void> {
    this.decisions.set(decision.jobKey, { ...decision });
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Fingerprints the exact staged payload a human is reviewing.
 *
 * The identity includes source document fingerprints, canonical answers,
 * extracted content, media gaps, semantic findings and importer version. A
 * source replacement, parser/recovery change or manual extraction correction
 * therefore invalidates the previous decision instead of silently reusing it.
 */
export async function buildReviewContentFingerprint(job: IngestionJobResult): Promise<string> {
  if (job.status !== "ready-for-review" || !job.stagedExam || !job.report) {
    throw new Error("only ready-for-review jobs can be fingerprinted for human review");
  }

  return sha256(
    stableJson({
      jobKey: job.jobKey,
      providerId: job.providerId,
      sourceId: job.sourceId,
      editionId: job.editionId,
      year: job.year,
      phase: job.phase,
      variant: job.variant ?? null,
      rightsStatus: job.rightsStatus,
      statementMode: job.statementMode,
      importerVersion: job.stagedExam.raw.importerVersion,
      fingerprints: job.stagedExam.raw.fingerprints,
      answerKey: job.stagedExam.raw.answerKey,
      annulled: job.stagedExam.raw.annulled,
      questions: job.stagedExam.questions,
      questionsMissingMedia: job.stagedExam.questionsMissingMedia,
      semanticFidelityIssues: job.stagedExam.semanticFidelityIssues,
      reportIssues: job.report.issues,
    }),
  );
}

export interface RecordReviewInput {
  disposition: ReviewDisposition;
  validationLevel?: ApprovedValidationLevel;
  reviewer: string;
  notes?: string;
}

export async function recordReviewDecision(
  store: ReviewDecisionStore,
  job: IngestionJobResult,
  input: RecordReviewInput,
  now: () => Date = () => new Date(),
): Promise<IngestionReviewDecision> {
  if (!input.reviewer.trim()) throw new Error("reviewer is required");
  if (input.disposition === "approved" && !input.validationLevel) {
    throw new Error("approved review requires reviewed or verified validation level");
  }
  if (input.disposition !== "approved" && input.validationLevel) {
    throw new Error("only approved review may grant a validation level");
  }

  const decision: IngestionReviewDecision = {
    jobKey: job.jobKey,
    contentFingerprint: await buildReviewContentFingerprint(job),
    disposition: input.disposition,
    validationLevel: input.validationLevel,
    reviewer: input.reviewer.trim(),
    reviewedAt: now().toISOString(),
    notes: input.notes?.trim() || undefined,
  };
  await store.set(decision);
  return { ...decision };
}

/** Returns null when the staged payload changed after the recorded review. */
export async function getApplicableReviewDecision(
  store: ReviewDecisionStore,
  job: IngestionJobResult,
): Promise<IngestionReviewDecision | null> {
  const recorded = await store.get(job.jobKey);
  if (!recorded) return null;
  const current = await buildReviewContentFingerprint(job);
  return recorded.contentFingerprint === current ? recorded : null;
}

/**
 * Explicit review → catalog handoff. Nothing in the ingestion engine calls
 * this automatically.
 */
export async function handoffReviewedJobToCatalog(
  store: ReviewDecisionStore,
  job: IngestionJobResult,
): Promise<ReviewedCatalogHandoff | null> {
  const decision = await getApplicableReviewDecision(store, job);
  if (!decision || decision.disposition !== "approved" || !decision.validationLevel) return null;
  if (!job.stagedExam || !job.report) return null;

  const edition = acceptEdition(job.stagedExam.raw, job.report, decision.validationLevel);
  if (!edition) return null;

  return {
    jobKey: job.jobKey,
    variant: job.variant,
    decision: { ...decision },
    edition,
  };
}
