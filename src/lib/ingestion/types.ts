import type {
  DiscoveredDocument,
  DiscoveredEdition,
  DocumentFingerprint,
  ExamSourceDiscovery,
  FetchedDocument,
  ImportReport,
  RawImportedExam,
} from "../sources/ingestion";
import type { ExtractionMethod, RightsStatus, StatementMode } from "../sources/types";

/**
 * One logical objective exam unit to ingest.
 *
 * A single discovered edition may expand into multiple plans when the
 * institution publishes phases, days or shuffled variants separately.
 */
export interface IngestionPlan {
  editionId: string;
  year: number;
  phase: string;
  variant?: string;
  expectedCount: number;
  allowedLetters: string[];
  documents: DiscoveredDocument[];
}

export interface ExtractedAlternative {
  id: string;
  text?: string;
  file?: string;
}

/** Content extracted from one question before human review. */
export interface ExtractedQuestion {
  number: number;
  subject?: string;
  statement?: string;
  context?: string;
  alternatives?: ExtractedAlternative[];
  files?: string[];
  page?: number;
  sourceDocumentUrl?: string;
  /** Optional extractor/model confidence in the range 0..1. */
  confidence?: number;
}

export type SemanticFidelityIssueSeverity = "warning" | "error";
export type SemanticFidelityIssueCode =
  | "control-character"
  | "replacement-character"
  | "private-use-character"
  | "formula-ambiguity"
  | "layout-ambiguity"
  | "extractor-reported";

export interface SemanticFidelityIssue {
  code: SemanticFidelityIssueCode;
  severity: SemanticFidelityIssueSeverity;
  message: string;
  questionNumber?: number;
  page?: number;
  field?: "statement" | "context" | `alternative:${string}`;
}

export type SelectiveFallbackReason =
  | "incomplete-structure"
  | "missing-media"
  | "semantic-fidelity";

export interface SelectiveFallbackTarget {
  questionNumber?: number;
  page?: number;
  reason: SelectiveFallbackReason;
  message: string;
}

/** Exception-driven work request. No full-exam retry is implied by this shape. */
export interface SelectiveFallbackRequest {
  targets: SelectiveFallbackTarget[];
}

/**
 * A selective fallback returns only replacement questions for requested
 * identities/pages. It cannot change the canonical answer key.
 */
export interface SelectiveFallbackResult {
  questions: ExtractedQuestion[];
  /** Media that remains unresolved among replacement questions. */
  questionsMissingMedia?: number[];
  /**
   * Primary missing-media flags are preserved by default. The fallback must
   * explicitly name question identities whose media dependency it resolved.
   */
  resolvedMissingMedia?: number[];
  semanticFidelityIssues?: SemanticFidelityIssue[];
  warnings?: string[];
}

export interface IngestionFallbackSummary {
  targetCount: number;
  replacedQuestions: number[];
  failed?: string;
}

/**
 * Provider-specific extractors return this neutral shape.
 *
 * The engine intentionally does not trust it: question numbering, count,
 * answer domain and document completeness still pass through the canonical
 * fail-closed validator.
 */
export interface ExtractedExamData {
  questions: ExtractedQuestion[];
  answerKey: Record<number, string>;
  annulled?: number[];
  subjects?: Record<string, number>;
  questionsMissingMedia?: number[];
  /** Explicit findings made by an extractor before text cleanup loses evidence. */
  semanticFidelityIssues?: SemanticFidelityIssue[];
  warnings?: string[];
}

export interface FetchedIngestionDocument {
  definition: DiscoveredDocument;
  fetched: FetchedDocument;
  fingerprint: DocumentFingerprint;
}

export interface IngestionExtractionContext {
  plan: IngestionPlan;
  documents: FetchedIngestionDocument[];
}

/**
 * Institution-specific behavior is isolated behind an adapter.
 *
 * Adapters describe how an official archive is discovered, how one edition
 * expands into logical exam units, and how the already-downloaded documents
 * are parsed. They do not publish anything themselves.
 */
export interface IngestionAdapter {
  readonly providerId: string;
  readonly sourceId: string;
  readonly importerVersion: string;
  readonly discovery: ExamSourceDiscovery;
  readonly statementMode: StatementMode;
  readonly extractionMethod: ExtractionMethod;
  readonly rightsStatus: RightsStatus;
  plan(edition: DiscoveredEdition): IngestionPlan[] | Promise<IngestionPlan[]>;
  extract(context: IngestionExtractionContext): Promise<ExtractedExamData>;
  /**
   * Optional exception-driven OCR/AI/media fallback. The engine calls it only
   * when primary extraction identifies concrete problematic questions/pages.
   */
  fallbackExtract?(
    context: IngestionExtractionContext,
    request: SelectiveFallbackRequest,
    primary: ExtractedExamData,
  ): Promise<SelectiveFallbackResult>;
}

export type IngestionStage =
  | "configuration"
  | "discovery"
  | "planning"
  | "fetch"
  | "fingerprint"
  | "extraction"
  | "validation";

export type IngestionEngineIssueCode =
  | "source-mismatch"
  | "not-allowed"
  | "invalid-plan"
  | "duplicate-job"
  | "fetch-failed"
  | "fingerprint-failed"
  | "extract-failed"
  | "invalid-extraction";

export interface IngestionEngineIssue {
  code: IngestionEngineIssueCode;
  stage: IngestionStage;
  message: string;
}

export interface StagedImportedExam {
  raw: RawImportedExam;
  /** Kept here because the current canonical RawImportedExam predates variants. */
  variant?: string;
  /** Exact objective answer domain expected for this logical exam. */
  allowedLetters: string[];
  questions: ExtractedQuestion[];
  /** Questions whose meaning still depends on visual/media content not associated yet. */
  questionsMissingMedia: number[];
  /** Machine-detectable or extractor-reported semantic fidelity findings. */
  semanticFidelityIssues: SemanticFidelityIssue[];
  /** Present only when an optional selective fallback was attempted. */
  fallback?: IngestionFallbackSummary;
  warnings: string[];
}

export type IngestionJobStatus = "ready-for-review" | "blocked";

export interface IngestionJobResult {
  jobKey: string;
  providerId: string;
  sourceId: string;
  editionId: string;
  year: number;
  phase: string;
  variant?: string;
  status: IngestionJobStatus;
  rightsStatus: RightsStatus;
  statementMode: StatementMode;
  engineIssues: IngestionEngineIssue[];
  report: ImportReport | null;
  stagedExam: StagedImportedExam | null;
  documentsDiscovered: number;
  documentsFetched: number;
  durationMs: number;
}

export interface IngestionSourceFailure {
  providerId: string;
  sourceId: string;
  editionId?: string;
  stage: "configuration" | "discovery" | "planning";
  message: string;
}

export interface SkippedEdition {
  providerId: string;
  sourceId: string;
  editionId: string;
  reason: "not-allowed";
}

export interface IngestionReviewItem {
  jobKey: string;
  providerId: string;
  sourceId: string;
  editionId: string;
  year: number;
  phase: string;
  variant?: string;
  questionCount: number;
  /** Statement + exact alternative domain recovered, independent of rights. */
  structurallyCompleteQuestions: number;
  /**
   * Structurally complete questions that do not still depend on missing media.
   * This is a structural/media readiness metric only. It does not prove that
   * formulas, typography, symbols or text semantics survived PDF extraction.
   */
  contentReadyQuestions: number;
  /** Questions without a blocking semantic-fidelity finding. */
  semanticFidelityReadyQuestions: number;
  /** Unique question identities still needing structural/media/semantic fallback. */
  questionsNeedingFallback: number;
  /** Number of questions that still need visual/media association. */
  questionsMissingMedia: number;
  rightsStatus: RightsStatus;
  /**
   * Candidate means only that native review makes sense. Publication still
   * requires the existing reviewed/verified structured-content gate and all
   * semantic-fidelity checks.
   */
  nativeContentCandidate: boolean;
  fallback?: IngestionFallbackSummary;
  semanticFidelityIssues: SemanticFidelityIssue[];
  warnings: string[];
}

export interface IngestionRunSummary {
  sources: number;
  editionsDiscovered: number;
  jobsPlanned: number;
  readyForReview: number;
  blocked: number;
  skippedNotAllowed: number;
  documentsFetched: number;
  questionsExtracted: number;
  structurallyCompleteQuestions: number;
  /** Structural/media readiness only; not a semantic-fidelity guarantee. */
  contentReadyQuestions: number;
  semanticFidelityReadyQuestions: number;
  questionsNeedingFallback: number;
  questionsMissingMedia: number;
  fallbackAttempts: number;
  fallbackReplacements: number;
}

export interface IngestionRunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  jobs: IngestionJobResult[];
  reviewQueue: IngestionReviewItem[];
  sourceFailures: IngestionSourceFailure[];
  skippedEditions: SkippedEdition[];
  summary: IngestionRunSummary;
}

export interface IngestionEngineOptions {
  /** Maximum number of logical exams processed at once. */
  concurrency?: number;
  /** Last known fingerprint by canonical document URL. */
  previousFingerprints?: Record<string, DocumentFingerprint>;
  /** Injectable clock keeps offline tests deterministic when needed. */
  now?: () => Date;
  runId?: string;
}
