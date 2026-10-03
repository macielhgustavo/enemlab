import { describe, expect, it } from "vitest";
import { DiscoveryEngine } from "./engine";

describe("DiscoveryEngine source authority", () => {
  it("does not let an aggregator rectification override an official final source", () => {
    const engine = new DiscoveryEngine();
    engine.registerExams([
      {
        id: "official-final",
        institution: "TEST_UNI",
        examName: "Test 2025",
        year: 2025,
        phase: "first",
        status: "final",
        totalQuestions: 1,
        hasOfficialAnswerKey: true,
        hasExamDocument: true,
        aggregatorSourceId: "test-uni-official",
        sourceRole: "official",
        validationLevel: "reviewed",
        discoveredAt: "2026-09-09T18:00:00-03:00",
        questions: [{ questionNumber: 1, correctAnswer: "A" }],
      },
      {
        id: "aggregator-rectified",
        institution: "TEST_UNI",
        examName: "Test 2025",
        year: 2025,
        phase: "first",
        status: "rectified",
        totalQuestions: 1,
        hasOfficialAnswerKey: true,
        hasExamDocument: true,
        aggregatorSourceId: "qconcursos",
        sourceRole: "discovery-only",
        discoveredAt: "2026-09-09T19:00:00-03:00",
        questions: [{ questionNumber: 1, correctAnswer: "B" }],
      },
    ]);

    const index = engine.buildIndex();
    expect(index.exams).toHaveLength(1);
    expect(index.exams[0].aggregatorSourceId).toBe("test-uni-official");
    expect(index.exams[0].questions?.[0].correctAnswer).toBe("A");
    expect(index.exams[0].corroboratedBy).toContain("qconcursos");
  });

  it("still fails closed when two official sources of equal authority disagree", () => {
    const engine = new DiscoveryEngine();
    engine.registerExams([
      {
        id: "official-a",
        institution: "TEST_UNI",
        examName: "Test 2025",
        year: 2025,
        phase: "first",
        status: "rectified",
        totalQuestions: 1,
        hasOfficialAnswerKey: true,
        hasExamDocument: true,
        aggregatorSourceId: "official-a",
        sourceRole: "official",
        validationLevel: "reviewed",
        discoveredAt: "2026-09-09T18:00:00-03:00",
        questions: [{ questionNumber: 1, correctAnswer: "A" }],
      },
      {
        id: "official-b",
        institution: "TEST_UNI",
        examName: "Test 2025",
        year: 2025,
        phase: "first",
        status: "rectified",
        totalQuestions: 1,
        hasOfficialAnswerKey: true,
        hasExamDocument: true,
        aggregatorSourceId: "official-b",
        sourceRole: "official",
        validationLevel: "reviewed",
        discoveredAt: "2026-09-09T18:05:00-03:00",
        questions: [{ questionNumber: 1, correctAnswer: "C" }],
      },
    ]);

    const index = engine.buildIndex();
    expect(index.exams).toEqual([]);
    expect(index.conflicts[0].reason).toContain("Answer conflict on Q1");
  });
});
