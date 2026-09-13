import type { ValidationLevel } from "../sources/ingestion";
import type { RightsStatus } from "../sources/types";

export interface AggregatorSourceMeta {
  id: string;
  name: string;
  baseUrl: string;
  rightsStatus: RightsStatus;
  supportsAnswers: boolean;
  supportsExams: boolean;
  supportsQuestions: boolean;
  priority: number; // Used only as a deterministic tie-breaker after sources agree.
}

export type ExamStatus = "final" | "preliminary" | "rectified" | "annulled" | "unknown";

/** Historical discovery role. Existing callers may continue to use it. */
export type DiscoverySourceRole = "official" | "discovery-only";

/**
 * Authority of the content candidate, independent from redistribution rights.
 *
 * `reviewed-nonofficial` is deliberately explicit: a mirror/aggregator may be
 * useful for a personal study corpus, but it does not become official merely
 * because a reviewer accepted its evidence.
 */
export type ContentAuthority = "official" | "reviewed-nonofficial" | "discovery-only";

export interface NonOfficialEvidenceReview {
  reviewer: string;
  reviewedAt: string;
  /** What justified accepting this evidence, without changing its authority. */
  basis: "manual-document-review" | "independent-corroboration";
  notes?: string;
}

export interface DiscoveredAnswerOption {
  letter: string;
  text?: string;
  isCorrect?: boolean;
}

export interface DiscoveredQuestionRef {
  questionNumber: number;
  statementSnippet?: string;
  options?: DiscoveredAnswerOption[];
  correctAnswer?: string;
  isAnnulled?: boolean;
  subject?: string;
  sourceUrl?: string;
  fingerprint?: string;
}

export interface DiscoveredExam {
  id: string;
  institution: string;
  examName: string;
  year: number;
  phase?: string;
  edition?: string;
  variant?: string;
  status: ExamStatus;
  totalQuestions: number;
  /** Explicit answer domain for objective exams, e.g. ["A", "B", "C", "D", "E"]. */
  allowedLetters?: string[];
  hasOfficialAnswerKey: boolean;
  /** A usable answer-key document exists even when its hosting source is non-official. */
  hasAnswerKeyDocument?: boolean;
  hasExamDocument: boolean;
  examDocumentUrl?: string;
  answerKeyDocumentUrl?: string;
  questionsUrl?: string;
  /** Historical name kept for compatibility; this is the discovery source id. */
  aggregatorSourceId: string;
  /** Defaults conceptually to discovery-only when omitted. */
  sourceRole?: DiscoverySourceRole;
  /** Defaults from sourceRole when omitted. */
  contentAuthority?: ContentAuthority;
  /** Required before reviewed non-official evidence may cross the catalog gate. */
  nonOfficialEvidenceReview?: NonOfficialEvidenceReview;
  /** Canonical ingestion level. Required before data can be published. */
  validationLevel?: ValidationLevel;
  /** Sources that independently corroborated the same candidate identity. */
  corroboratedBy?: string[];
  discoveredAt: string;
  questions?: DiscoveredQuestionRef[];
  notes?: string;
}

export interface VestibularDiscoveryIndex {
  generatedAt: string;
  sources: AggregatorSourceMeta[];
  institutionsCount: number;
  examsCount: number;
  totalQuestionsEstimated: number;
  exams: DiscoveredExam[];
  conflicts: {
    examId: string;
    institution: string;
    year: number;
    reason: string;
    resolved: boolean;
    chosenValue?: string;
  }[];
}

export interface NormalizationResult {
  normalizedExam: DiscoveredExam;
  duplicatesFound: number;
  isFailClosed: boolean;
  failReason?: string;
}

export function contentAuthorityOf(exam: Pick<DiscoveredExam, "contentAuthority" | "sourceRole">): ContentAuthority {
  if (exam.contentAuthority) return exam.contentAuthority;
  return exam.sourceRole === "official" ? "official" : "discovery-only";
}
