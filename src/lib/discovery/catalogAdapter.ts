import type { DiscoveredExam, DiscoveredQuestionRef } from "./types";
import { generateQuestionFingerprint, generateExamFingerprint } from "./fingerprint";

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
};

export function canPublishExamToCatalog(exam: DiscoveredExam): exam is PublishableDiscoveredExam {
  return (
    exam.sourceRole === "official" &&
    (exam.validationLevel === "verified" || exam.validationLevel === "reviewed")
  );
}

/**
 * Converts an official, reviewed discovery result into catalog candidates.
 *
 * Aggregators are discovery hints only. A candidate cannot cross this boundary
 * until the official-source ingestion pipeline has validated/reviewed it.
 */
export function convertExamToCatalogQuestions(exam: DiscoveredExam): CatalogQuestionItem[] {
  if (!canPublishExamToCatalog(exam) || !exam.questions || exam.questions.length === 0) {
    return [];
  }

  const providerId = exam.institution.toLowerCase().replace(/[^a-z0-9]/g, "");
  const examFp = generateExamFingerprint(exam);

  return exam.questions.map((q: DiscoveredQuestionRef) => {
    const qFp = generateQuestionFingerprint(examFp, q);
    return {
      id: qFp,
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
        questionFingerprint: qFp,
      },
    };
  });
}
