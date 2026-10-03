import type { DiscoveredExam, DiscoveredQuestionRef } from "./types";
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
    sourceRole: "official";
    validationLevel: "verified" | "reviewed";
    discoveredAt: string;
    corroboratedBy: string[];
    examFingerprint: string;
    questionFingerprint: string;
  };
}

type PublishableDiscoveredExam = DiscoveredExam & {
  sourceRole: "official";
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
      // The canonical ingestion validator rejects an annulled question that
      // simultaneously carries an answer. Preserve the same invariant here.
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

export function canPublishExamToCatalog(exam: DiscoveredExam): exam is PublishableDiscoveredExam {
  const allowedLetters = canonicalAllowedLetters(exam);
  if (!allowedLetters) return false;

  return (
    exam.sourceRole === "official" &&
    (exam.validationLevel === "verified" || exam.validationLevel === "reviewed") &&
    (exam.status === "final" || exam.status === "rectified") &&
    exam.hasOfficialAnswerKey &&
    exam.hasExamDocument &&
    Boolean(exam.aggregatorSourceId.trim()) &&
    /^https:\/\//.test(exam.examDocumentUrl ?? "") &&
    /^https:\/\//.test(exam.answerKeyDocumentUrl ?? "") &&
    !Number.isNaN(Date.parse(exam.discoveredAt)) &&
    hasCompleteObjectiveCoverage(exam, allowedLetters)
  );
}

/**
 * Converts an official, reviewed discovery result into catalog candidates.
 *
 * Aggregators are discovery hints only. A candidate cannot cross this boundary
 * until the official-source ingestion pipeline has validated/reviewed it.
 * The catalog id is structural and stable; text-dependent fingerprints stay
 * inside provenance so re-extraction cannot destroy user history/SRS identity.
 */
export function convertExamToCatalogQuestions(exam: DiscoveredExam): CatalogQuestionItem[] {
  if (!canPublishExamToCatalog(exam)) return [];

  const providerId = exam.institution.toLowerCase().replace(/[^a-z0-9]/g, "");
  const examFp = generateExamFingerprint(exam);

  return exam.questions.map((q: DiscoveredQuestionRef) => {
    const stableId = generateQuestionIdentityFingerprint(examFp, q.questionNumber);
    const contentFp = generateQuestionFingerprint(examFp, q);
    return {
      id: stableId,
      providerId,
      year: exam.year,
      number: q.questionNumber,
      correctAnswer: q.isAnnulled ? undefined : q.correctAnswer,
      isAnnulled: Boolean(q.isAnnulled),
      subject: q.subject ?? "Conhecimentos Gerais",
      sourceUrl: q.sourceUrl ?? exam.examDocumentUrl,
      provenance: {
        institution: exam.institution,
        sourceId: exam.aggregatorSourceId,
        sourceRole: exam.sourceRole,
        validationLevel: exam.validationLevel,
        discoveredAt: exam.discoveredAt,
        corroboratedBy: exam.corroboratedBy ? [...exam.corroboratedBy] : [],
        examFingerprint: examFp,
        questionFingerprint: contentFp,
      },
    };
  });
}
