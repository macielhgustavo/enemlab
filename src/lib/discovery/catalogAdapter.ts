import type {
  ContentAuthority,
  DiscoveredExam,
  DiscoveredQuestionRef,
  DiscoverySourceRole,
} from "./types";
import { contentAuthorityOf } from "./types";
import {
  generateExamFingerprint,
  generateQuestionFingerprint,
  generateQuestionIdentityFingerprint,
} from "./fingerprint";

export interface CatalogQuestionItem {
  id: string;
  providerId: string;
  year: number;
  number: number;
  correctAnswer?: string;
  isAnnulled: boolean;
  subject?: string;
  sourceUrl?: string;
  provenance: {
    institution: string;
    sourceId: string;
    sourceRole: DiscoverySourceRole;
    contentAuthority: Exclude<ContentAuthority, "discovery-only">;
    validationLevel: "verified" | "reviewed";
    discoveredAt: string;
    corroboratedBy: string[];
    examFingerprint: string;
    questionFingerprint: string;
  };
}

type PublishableDiscoveredExam = DiscoveredExam & {
  validationLevel: "verified" | "reviewed";
  questions: DiscoveredQuestionRef[];
  allowedLetters: string[];
  examDocumentUrl: string;
  answerKeyDocumentUrl: string;
};

function canonicalAllowedLetters(exam: DiscoveredExam): Set<string> | null {
  if (!exam.allowedLetters || exam.allowedLetters.length < 2) return null;
  const letters = exam.allowedLetters.map((letter) => letter.trim());
  if (
    letters.some((letter) => !/^[A-Z]$/.test(letter)) ||
    new Set(letters).size !== letters.length
  ) {
    return null;
  }
  return new Set(letters);
}

function hasCompleteObjectiveCoverage(
  exam: DiscoveredExam,
  allowedLetters: ReadonlySet<string>,
): exam is DiscoveredExam & { questions: DiscoveredQuestionRef[] } {
  if (!Number.isInteger(exam.totalQuestions) || exam.totalQuestions < 1) return false;
  if (!exam.questions || exam.questions.length !== exam.totalQuestions) return false;

  const byNumber = new Map<number, DiscoveredQuestionRef>();
  for (const question of exam.questions) {
    if (
      !Number.isInteger(question.questionNumber) ||
      question.questionNumber < 1 ||
      question.questionNumber > exam.totalQuestions ||
      byNumber.has(question.questionNumber)
    ) {
      return false;
    }

    if (question.isAnnulled) {
      if (question.correctAnswer !== undefined) return false;
    } else {
      const answer = question.correctAnswer?.trim();
      if (!answer || !allowedLetters.has(answer)) return false;
    }

    byNumber.set(question.questionNumber, question);
  }

  for (let number = 1; number <= exam.totalQuestions; number++) {
    if (!byNumber.has(number)) return false;
  }
  return true;
}

function validNonOfficialEvidenceReview(exam: DiscoveredExam): boolean {
  const review = exam.nonOfficialEvidenceReview;
  return Boolean(
    review?.reviewer.trim() &&
      !Number.isNaN(Date.parse(review.reviewedAt)) &&
      (review.basis === "manual-document-review" || review.basis === "independent-corroboration"),
  );
}

function hasAcceptableAuthority(exam: DiscoveredExam): boolean {
  const authority = contentAuthorityOf(exam);
  if (authority === "official") return exam.hasOfficialAnswerKey;
  if (authority !== "reviewed-nonofficial") return false;

  return (
    validNonOfficialEvidenceReview(exam) &&
    (exam.hasOfficialAnswerKey || exam.hasAnswerKeyDocument === true)
  );
}

export function canPublishExamToCatalog(exam: DiscoveredExam): exam is PublishableDiscoveredExam {
  const allowedLetters = canonicalAllowedLetters(exam);
  if (!allowedLetters) return false;

  return (
    hasAcceptableAuthority(exam) &&
    (exam.validationLevel === "verified" || exam.validationLevel === "reviewed") &&
    (exam.status === "final" || exam.status === "rectified") &&
    exam.hasExamDocument &&
    Boolean(exam.aggregatorSourceId.trim()) &&
    /^https:\/\//.test(exam.examDocumentUrl ?? "") &&
    /^https:\/\//.test(exam.answerKeyDocumentUrl ?? "") &&
    !Number.isNaN(Date.parse(exam.discoveredAt)) &&
    hasCompleteObjectiveCoverage(exam, allowedLetters)
  );
}

/**
 * Converts a reviewed discovery result into catalog candidates.
 *
 * Official evidence remains preferred. Non-official evidence can cross this
 * boundary only when its authority is explicitly `reviewed-nonofficial`, a
 * human evidence review is recorded, the answer document exists and every
 * normal structural/finality/validation gate passes. The original source role
 * is preserved in provenance; review never relabels it as official.
 */
export function convertExamToCatalogQuestions(exam: DiscoveredExam): CatalogQuestionItem[] {
  if (!canPublishExamToCatalog(exam)) return [];

  const authority = contentAuthorityOf(exam);
  if (authority === "discovery-only") return [];

  const providerId = exam.institution.toLowerCase().replace(/[^a-z0-9]/g, "");
  const examFp = generateExamFingerprint(exam);

  return exam.questions.map((question: DiscoveredQuestionRef) => {
    const stableId = generateQuestionIdentityFingerprint(examFp, question.questionNumber);
    const contentFp = generateQuestionFingerprint(examFp, question);
    return {
      id: stableId,
      providerId,
      year: exam.year,
      number: question.questionNumber,
      correctAnswer: question.isAnnulled ? undefined : question.correctAnswer,
      isAnnulled: Boolean(question.isAnnulled),
      subject: question.subject ?? "Conhecimentos Gerais",
      sourceUrl: question.sourceUrl ?? exam.examDocumentUrl,
      provenance: {
        institution: exam.institution,
        sourceId: exam.aggregatorSourceId,
        sourceRole: exam.sourceRole ?? "discovery-only",
        contentAuthority: authority,
        validationLevel: exam.validationLevel,
        discoveredAt: exam.discoveredAt,
        corroboratedBy: exam.corroboratedBy ? [...exam.corroboratedBy] : [],
        examFingerprint: examFp,
        questionFingerprint: contentFp,
      },
    };
  });
}
