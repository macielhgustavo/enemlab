import type { DiscoveredExam, DiscoveredQuestionRef } from "./types";

function normalizeIdentitySegment(value: string | undefined, fallback: string): string {
  const normalized = (value ?? fallback)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return normalized || fallback;
}

/**
 * Generates a stable identity fingerprint for an exam candidate.
 *
 * Identity deliberately excludes mutable/validated attributes such as
 * totalQuestions. Otherwise two sources reporting 71 vs 72 questions would
 * be placed in different groups and the mismatch could never be detected.
 */
export function generateExamFingerprint(
  exam: Pick<DiscoveredExam, "institution" | "year" | "phase" | "edition" | "variant">,
): string {
  const inst = normalizeIdentitySegment(exam.institution, "unknown").toUpperCase();
  const phase = normalizeIdentitySegment(exam.phase, "fase1");
  const edition = normalizeIdentitySegment(exam.edition, "geral");
  const variant = normalizeIdentitySegment(exam.variant, "semvariante");
  return `${inst}_${exam.year}_${phase}_${edition}_${variant}`;
}

/** Stable structural identity for a question candidate. Never includes text. */
export function generateQuestionIdentityFingerprint(
  examFingerprint: string,
  questionNumber: number,
): string {
  if (!Number.isInteger(questionNumber) || questionNumber < 1) {
    throw new Error(`invalid question number: ${questionNumber}`);
  }
  return `${examFingerprint}_q${questionNumber}`;
}

/**
 * Normalizes question text for comparison/search purposes.
 * Text must never be used as the stable identity of a question.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Generates a content fingerprint for a question candidate.
 *
 * This may change after a better extraction/transcription and is therefore
 * provenance/comparison metadata only. It must never be used as the stable
 * catalog/SRS identity.
 */
export function generateQuestionFingerprint(
  examFingerprint: string,
  q: DiscoveredQuestionRef,
): string {
  const identity = generateQuestionIdentityFingerprint(examFingerprint, q.questionNumber);
  const snippet = q.statementSnippet ? normalizeText(q.statementSnippet).slice(0, 50) : "";
  return `${identity}_${snippet}`;
}
