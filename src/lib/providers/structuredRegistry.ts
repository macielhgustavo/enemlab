export type StructuredQuestionValidationLevel = "reviewed" | "verified";
export type StructuredQuestionExtractionMethod =
  | "official-structured-data"
  | "deterministic-text-extraction"
  | "manual-transcription";

export interface StructuredQuestionProvenance {
  /** Official document that contains this exact question content. */
  documentUrl: string;
  /** SHA-256 of the document bytes used to produce the native content. */
  documentSha256: string;
  /** Version of the parser/transcription pipeline. */
  parserVersion: string;
  extractionMethod: StructuredQuestionExtractionMethod;
  /** ISO timestamp of the review that allowed publication. */
  reviewedAt: string;
}

export interface UniversalStructuredQuestion {
  providerId: string;
  year: number;
  number: number;
  phase?: string;
  statement: string;
  context?: string;
  alternatives: {
    letter: string;
    text: string;
  }[];
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
  };
}

function validateStructuredQuestion(question: UniversalStructuredQuestion): void {
  if (!question.providerId.trim()) throw new Error("structured question: providerId is required");
  if (!Number.isInteger(question.year) || question.year < 1900) {
    throw new Error(`structured question: invalid year ${question.year}`);
  }
  if (!Number.isInteger(question.number) || question.number < 1) {
    throw new Error(`structured question: invalid number ${question.number}`);
  }
  if (!question.statement.trim()) throw new Error("structured question: statement is required");
  if (question.alternatives.length < 2) {
    throw new Error("structured question: at least two alternatives are required");
  }

  const letters = question.alternatives.map((alternative) => alternative.letter.trim().toUpperCase());
  if (new Set(letters).size !== letters.length) {
    throw new Error("structured question: duplicate alternative letter");
  }
  if (question.alternatives.some((alternative) => !alternative.text.trim())) {
    throw new Error("structured question: alternative text is required");
  }

  if (!/^https:\/\//.test(question.provenance.documentUrl)) {
    throw new Error("structured question: official document URL is required");
  }
  if (!/^[0-9a-f]{64}$/i.test(question.provenance.documentSha256)) {
    throw new Error("structured question: documentSha256 must be a SHA-256 hex digest");
  }
  if (!question.provenance.parserVersion.trim()) {
    throw new Error("structured question: parserVersion is required");
  }
  if (Number.isNaN(Date.parse(question.provenance.reviewedAt))) {
    throw new Error("structured question: reviewedAt must be an ISO-compatible timestamp");
  }
}

/**
 * Registers content that is safe to expose natively in the runner.
 *
 * Draft/generated text without official-document provenance must stay outside
 * this runtime registry. This keeps `statementAvailable=true` equivalent to
 * "we can prove where this exact content came from and it was reviewed".
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
