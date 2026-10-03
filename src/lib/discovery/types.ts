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

/**
 * Discovery sources may suggest that an edition exists, but only an official
 * source that passed the canonical ingestion/review pipeline may publish data.
 */
export type DiscoverySourceRole = "official" | "discovery-only";

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
  institution: string; // e.g., UNICAMP, UNESP, UEM, UEL, UEPG, UFSC, UDESC, ACAFE, Mackenzie, PUC-PR, PUC-SP, PUC-Rio
  examName: string;
  year: number;
  phase?: string; // e.g., "1a_fase", "2a_fase", "dia1", "dia2"
  edition?: string; // e.g., "Inverno", "Verão", "Geral"
  variant?: string; // e.g., "V1", "Provas V/K/Q/X/Z", "Caderno 1"
  status: ExamStatus;
  totalQuestions: number;
  /** Explicit answer domain for objective exams, e.g. ["A", "B", "C", "D", "E"]. */
  allowedLetters?: string[];
  hasOfficialAnswerKey: boolean;
  hasExamDocument: boolean;
  examDocumentUrl?: string;
  answerKeyDocumentUrl?: string;
  questionsUrl?: string;
  /** Historical name kept for compatibility; this is the discovery source id. */
  aggregatorSourceId: string;
  /** Defaults conceptually to discovery-only when omitted. */
  sourceRole?: DiscoverySourceRole;
  /** Canonical ingestion level. Required before official data can be published. */
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
