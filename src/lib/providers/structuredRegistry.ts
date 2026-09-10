import type { ExamSource, NormalizedQuestion } from "./types";
import type { ExtractionMethod, RightsStatus } from "../sources/types";

export type StructuredQuestionValidationLevel = "reviewed" | "verified";
export type NativeExtractionMethod = Exclude<ExtractionMethod, "none">;

export interface StructuredQuestionProvenance {
  /** Official document that contains this exact question content. */
  documentUrl: string;
  /** Page containing the question when the source is paginated. */
  page?: number;
  /** SHA-256 of the document bytes used to produce the native content. */
  documentSha256: string;
  /** Version of the parser/transcription pipeline. */
  parserVersion: string;
  extractionMethod: NativeExtractionMethod;
  /**
   * Operational reuse status from the canonical source model. Native runtime
   * publication is allowed only when this is explicitly `allowed`.
   */
  rightsStatus: RightsStatus;
  /** ISO timestamp of the review that allowed publication. */
  reviewedAt: string;
}

export interface StructuredAlternative {
  letter: string;
  /** Text may be absent when the official alternative is purely visual. */
  text?: string;
  /** Image/media asset associated with this alternative. */
  file?: string;
}

export interface UniversalStructuredQuestion {
  providerId: string;
  year: number;
  number: number;
  phase?: string;
  statement: string;
  context?: string;
  alternativesIntroduction?: string;
  alternatives: StructuredAlternative[];
  /** Images/diagrams/media used by the statement itself. */
  files?: string[];
  /** Sources explicitly cited by the original question. */
  sources?: ExamSource[];
  validationLevel: StructuredQuestionValidationLevel;
  provenance: StructuredQuestionProvenance;
}

const REGISTRY = new Map<string, UniversalStructuredQuestion>();

function makeKey(providerId: string, year: number, number: number, phase = "first"): string {
  return `${providerId.toLowerCase()}-${year}-${phase.toLowerCase()}-${number}`;
}

function cloneQuestion(question: UniversalStructuredQuestion): UniversalStructuredQuestion {
  return {
    ...question,
    provenance: { ...question.provenance },
    alternatives: question.alternatives.map((alternative) => ({ ...alternative })),
    files: question.files ? [...question.files] : undefined,
    sources: question.sources?.map((source) => ({ ...source })),
  };
}

export function validateStructuredQuestion(question: UniversalStructuredQuestion): void {
  if (!question.providerId.trim()) throw new Error("structured question: providerId is required");
  if (!Number.isInteger(question.year) || question.year < 1900) {
    throw new Error(`structured question: invalid year ${question.year}`);
  }
  if (!Number.isInteger(question.number) || question.number < 1) {
    throw new Error(`structured question: invalid number ${question.number}`);
  }
  if (
    question.validationLevel !== "reviewed" &&
    question.validationLevel !== "verified"
  ) {
    throw new Error("structured question: native content must be reviewed or verified");
  }
  if (!question.statement.trim()) throw new Error("structured question: statement is required");
  if (question.alternatives.length < 2) {
    throw new Error("structured question: at least two alternatives are required");
  }

  const letters = question.alternatives.map((alternative) => alternative.letter.trim());
  if (
    letters.some((letter) => !/^[A-Z0-9]+$/.test(letter)) ||
    new Set(letters).size !== letters.length
  ) {
    throw new Error("structured question: alternative letters must be unique canonical IDs");
  }
  if (
    question.alternatives.some(
      (alternative) => !alternative.text?.trim() && !alternative.file?.trim(),
    )
  ) {
    throw new Error("structured question: every alternative needs text or media");
  }

  if (question.files?.some((file) => !file.trim())) {
    throw new Error("structured question: statement media path cannot be empty");
  }
  if (question.sources?.some((source) => !source.label.trim())) {
    throw new Error("structured question: cited source label cannot be empty");
  }

  if (!/^https:\/\//.test(question.provenance.documentUrl)) {
    throw new Error("structured question: official document URL is required");
  }
  if (
    question.provenance.page !== undefined &&
    (!Number.isInteger(question.provenance.page) || question.provenance.page < 1)
  ) {
    throw new Error("structured question: provenance page must be a positive integer");
  }
  if (!/^[0-9a-f]{64}$/i.test(question.provenance.documentSha256)) {
    throw new Error("structured question: documentSha256 must be a SHA-256 hex digest");
  }
  if (!question.provenance.parserVersion.trim()) {
    throw new Error("structured question: parserVersion is required");
  }
  if ((question.provenance.extractionMethod as ExtractionMethod) === "none") {
    throw new Error("structured question: native content requires a real extraction method");
  }
  if (question.provenance.rightsStatus !== "allowed") {
    throw new Error(
      `structured question: native publication requires rightsStatus=allowed, got ${question.provenance.rightsStatus}`,
    );
  }
  if (Number.isNaN(Date.parse(question.provenance.reviewedAt))) {
    throw new Error("structured question: reviewedAt must be an ISO-compatible timestamp");
  }
}

/**
 * Registers content that is safe to expose natively in the runner.
 *
 * Draft/generated text, unreviewed extraction, or content without explicit
 * reuse permission must stay outside this runtime registry. This keeps
 * `statementAvailable=true` equivalent to "we can prove where this exact
 * content came from, it was reviewed, and it may be redistributed".
 */
export function registerStructuredQuestion(question: UniversalStructuredQuestion): void {
  validateStructuredQuestion(question);
  const key = makeKey(
    question.providerId,
    question.year,
    question.number,
    question.phase ?? "first",
  );
  REGISTRY.set(key, cloneQuestion(question));
}

export function getStructuredQuestion(
  providerId: string,
  year: number,
  number: number,
  phase = "first",
): UniversalStructuredQuestion | null {
  const key = makeKey(providerId, year, number, phase);
  const question = REGISTRY.get(key);
  return question ? cloneQuestion(question) : null;
}

/**
 * Applies reviewed native content to a provider's existing reference question.
 *
 * Providers keep ownership of identity, subject, answer key and correction.
 * The registry owns only the native statement/media overlay. Requiring the
 * exact same identity and alternative IDs prevents a malformed payload from
 * showing content against the wrong question or answer-key letters.
 */
export function withStructuredQuestionContent(
  base: NormalizedQuestion,
  structured: UniversalStructuredQuestion | null,
  institution: string,
): NormalizedQuestion {
  if (!structured) return base;
  validateStructuredQuestion(structured);

  const baseNumber = base.number ?? base.index;
  const structuredPhase = structured.phase ?? "first";
  if (
    base.providerId !== structured.providerId ||
    base.year !== structured.year ||
    baseNumber !== structured.number ||
    base.phase !== structuredPhase
  ) {
    throw new Error(
      `structured question ${structured.providerId}-${structured.year}-${structuredPhase}-${structured.number}: identity does not match provider question ${base.providerId}-${base.year}-${base.phase}-${baseNumber}`,
    );
  }

  const baseLetters = base.alternatives.map((alternative) => alternative.letter);
  const structuredLetters = structured.alternatives.map((alternative) => alternative.letter);
  if (
    baseLetters.length !== structuredLetters.length ||
    baseLetters.some((letter) => !structuredLetters.includes(letter))
  ) {
    throw new Error(
      `structured question ${structured.providerId}-${structured.year}-${structured.number}: alternative set does not match provider`,
    );
  }

  return {
    ...base,
    context: [structured.context, structured.statement].filter(Boolean).join("\n\n"),
    alternativesIntroduction: structured.alternativesIntroduction ?? null,
    alternatives: base.alternatives.map((alternative) => {
      const native = structured.alternatives.find((item) => item.letter === alternative.letter)!;
      return {
        ...alternative,
        text: native.text ?? null,
        file: native.file ?? null,
      };
    }),
    files: structured.files ? [...structured.files] : [],
    sources: structured.sources?.map((source) => ({ ...source })) ?? [],
    statementAvailable: true,
    official: {
      official: true,
      institution,
      documentUrl: structured.provenance.documentUrl,
      page: structured.provenance.page,
    },
  };
}
