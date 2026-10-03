import { describe, expect, it } from "vitest";
import { canPublishExamToCatalog, convertExamToCatalogQuestions } from "./catalogAdapter";
import type { DiscoveredExam } from "./types";

function officialExam(statementSnippet: string): DiscoveredExam {
  return {
    id: "official-2025",
    institution: "TEST_UNI",
    examName: "Test 2025",
    year: 2025,
    phase: "first",
    edition: "geral",
    status: "final",
    totalQuestions: 1,
    allowedLetters: ["A", "B"],
    hasOfficialAnswerKey: true,
    hasExamDocument: true,
    examDocumentUrl: "https://example.edu/prova.pdf",
    answerKeyDocumentUrl: "https://example.edu/gabarito.pdf",
    aggregatorSourceId: "test-uni-official",
    sourceRole: "official",
    validationLevel: "reviewed",
    discoveredAt: "2026-09-09T18:00:00-03:00",
    questions: [{ questionNumber: 1, correctAnswer: "A", statementSnippet }],
  };
}

describe("catalog adapter identity", () => {
  it("keeps the stable question id when extracted text changes", () => {
    const first = convertExamToCatalogQuestions(officialExam("Texto extraído com erro"))[0];
    const corrected = convertExamToCatalogQuestions(officialExam("Texto oficial corrigido"))[0];

    expect(first.id).toBe(corrected.id);
    expect(first.provenance.questionFingerprint).not.toBe(
      corrected.provenance.questionFingerprint,
    );
  });
});

describe("catalog publication boundary", () => {
  it("accepts a complete official reviewed final edition", () => {
    expect(canPublishExamToCatalog(officialExam("Texto oficial"))).toBe(true);
  });

  it("rejects a partial edition even if someone marked it reviewed", () => {
    const exam = officialExam("Texto oficial");
    exam.totalQuestions = 2;

    expect(canPublishExamToCatalog(exam)).toBe(false);
    expect(convertExamToCatalogQuestions(exam)).toEqual([]);
  });

  it("rejects preliminary answer keys from publication", () => {
    const exam = officialExam("Texto oficial");
    exam.status = "preliminary";

    expect(canPublishExamToCatalog(exam)).toBe(false);
  });

  it("rejects duplicate question numbers", () => {
    const exam = officialExam("Texto oficial");
    exam.totalQuestions = 2;
    exam.questions = [
      { questionNumber: 1, correctAnswer: "A" },
      { questionNumber: 1, correctAnswer: "B" },
    ];

    expect(canPublishExamToCatalog(exam)).toBe(false);
  });

  it("rejects a non-annulled question without an answer", () => {
    const exam = officialExam("Texto oficial");
    exam.questions = [{ questionNumber: 1 }];

    expect(canPublishExamToCatalog(exam)).toBe(false);
  });

  it("rejects answers outside the declared letter domain", () => {
    const exam = officialExam("Texto oficial");
    exam.questions = [{ questionNumber: 1, correctAnswer: "C" }];

    expect(canPublishExamToCatalog(exam)).toBe(false);
  });

  it("rejects editions without an explicit canonical letter domain", () => {
    const exam = officialExam("Texto oficial");
    exam.allowedLetters = undefined;

    expect(canPublishExamToCatalog(exam)).toBe(false);
  });

  it("rejects an annulled question that still carries an answer", () => {
    const exam = officialExam("Texto oficial");
    exam.questions = [{ questionNumber: 1, isAnnulled: true, correctAnswer: "A" }];

    expect(canPublishExamToCatalog(exam)).toBe(false);
  });

  it("accepts an annulled question only when the answer is absent", () => {
    const exam = officialExam("Texto oficial");
    exam.questions = [{ questionNumber: 1, isAnnulled: true }];

    expect(canPublishExamToCatalog(exam)).toBe(true);
  });

  it("rejects boolean document flags without actual official URLs", () => {
    const exam = officialExam("Texto oficial");
    exam.answerKeyDocumentUrl = undefined;

    expect(canPublishExamToCatalog(exam)).toBe(false);
  });
});
