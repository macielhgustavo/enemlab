import { describe, expect, it } from "vitest";
import { canPublishExamToCatalog, convertExamToCatalogQuestions } from "./catalogAdapter";
import type { DiscoveredExam } from "./types";

function exam(overrides: Partial<DiscoveredExam> = {}): DiscoveredExam {
  return {
    id: "demo-2026",
    institution: "Demo University",
    examName: "Entrance Exam",
    year: 2026,
    phase: "first",
    status: "final",
    totalQuestions: 2,
    allowedLetters: ["A", "B", "C", "D", "E"],
    hasOfficialAnswerKey: false,
    hasAnswerKeyDocument: true,
    hasExamDocument: true,
    examDocumentUrl: "https://mirror.example/exam.pdf",
    answerKeyDocumentUrl: "https://mirror.example/key.pdf",
    aggregatorSourceId: "mirror-example",
    sourceRole: "discovery-only",
    validationLevel: "reviewed",
    discoveredAt: "2026-09-12T12:00:00.000Z",
    questions: [
      { questionNumber: 1, correctAnswer: "A", sourceUrl: "https://mirror.example/exam.pdf" },
      { questionNumber: 2, correctAnswer: "B", sourceUrl: "https://mirror.example/exam.pdf" },
    ],
    ...overrides,
  };
}

describe("reviewed non-official discovery evidence", () => {
  it("keeps ordinary discovery-only candidates blocked", () => {
    expect(canPublishExamToCatalog(exam())).toBe(false);
  });

  it("requires an explicit human evidence review", () => {
    expect(
      canPublishExamToCatalog(exam({ contentAuthority: "reviewed-nonofficial" })),
    ).toBe(false);
  });

  it("publishes reviewed non-official evidence without relabeling it official", () => {
    const candidate = exam({
      contentAuthority: "reviewed-nonofficial",
      nonOfficialEvidenceReview: {
        reviewer: "reviewer-1",
        reviewedAt: "2026-09-12T13:00:00.000Z",
        basis: "manual-document-review",
      },
    });

    expect(canPublishExamToCatalog(candidate)).toBe(true);
    const items = convertExamToCatalogQuestions(candidate);
    expect(items).toHaveLength(2);
    expect(items[0].provenance.sourceRole).toBe("discovery-only");
    expect(items[0].provenance.contentAuthority).toBe("reviewed-nonofficial");
    expect(items[0].provenance.validationLevel).toBe("reviewed");
  });

  it("still blocks preliminary data", () => {
    expect(
      canPublishExamToCatalog(
        exam({
          status: "preliminary",
          contentAuthority: "reviewed-nonofficial",
          nonOfficialEvidenceReview: {
            reviewer: "reviewer-1",
            reviewedAt: "2026-09-12T13:00:00.000Z",
            basis: "independent-corroboration",
          },
        }),
      ),
    ).toBe(false);
  });

  it("still requires a concrete answer-key document", () => {
    expect(
      canPublishExamToCatalog(
        exam({
          hasAnswerKeyDocument: false,
          contentAuthority: "reviewed-nonofficial",
          nonOfficialEvidenceReview: {
            reviewer: "reviewer-1",
            reviewedAt: "2026-09-12T13:00:00.000Z",
            basis: "manual-document-review",
          },
        }),
      ),
    ).toBe(false);
  });
});
