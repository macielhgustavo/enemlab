import { describe, expect, it } from "vitest";
import { DiscoveryEngine } from "./engine";
import { generateExamFingerprint, normalizeText } from "./fingerprint";
import { canPublishExamToCatalog, convertExamToCatalogQuestions } from "./catalogAdapter";
import { DISCOVERED_EXAMS_DATASET } from "./mockData";
import type { DiscoveredExam } from "./types";

describe("Meta-Discovery Wave Expansion & Catalog Adapter Unit Tests (Offline)", () => {
  it("normalizes text correctly for comparison", () => {
    expect(normalizeText("Água, Café e Açúcar 123!")).toBe("aguacafeeacucar123");
  });

  it("fingerprints exam identity without mutable question counts", () => {
    const fp1 = generateExamFingerprint({
      institution: "unicamp",
      year: 2025,
      phase: "1a_fase",
      edition: "geral",
      variant: "Caderno Q",
    });
    const fp2 = generateExamFingerprint({
      institution: "UNICAMP ",
      year: 2025,
      phase: "1a_FASE",
      edition: "Geral",
      variant: "caderno q",
    });

    expect(fp1).toBe(fp2);
    expect(fp1).toBe("UNICAMP_2025_1afase_geral_cadernoq");
  });

  it("keeps distinct variants in distinct identity groups", () => {
    const v1 = generateExamFingerprint({
      institution: "FUVEST",
      year: 2025,
      phase: "first",
      edition: "geral",
      variant: "V1",
    });
    const v2 = generateExamFingerprint({
      institution: "FUVEST",
      year: 2025,
      phase: "first",
      edition: "geral",
      variant: "V2",
    });

    expect(v1).not.toBe(v2);
  });

  it("builds a discovery index without treating it as published catalog data", () => {
    const engine = new DiscoveryEngine();
    engine.registerExams(DISCOVERED_EXAMS_DATASET);

    const index = engine.buildIndex();

    expect(index.sources.length).toBeGreaterThanOrEqual(10);
    expect(index.institutionsCount).toBeGreaterThanOrEqual(18);
    expect(index.examsCount).toBeGreaterThanOrEqual(20);
    expect(index.totalQuestionsEstimated).toBeGreaterThan(1500);

    const unicamp2025 = index.exams.find(
      (exam) => exam.institution === "UNICAMP" && exam.year === 2025,
    );
    expect(unicamp2025).toBeDefined();
    expect(unicamp2025?.corroboratedBy).toContain("qconcursos");
    expect(unicamp2025?.corroboratedBy).toContain("kuadro");
    expect(unicamp2025 ? canPublishExamToCatalog(unicamp2025) : true).toBe(false);
  });

  it("does not let discovery-only aggregator data cross into the catalog", () => {
    const engine = new DiscoveryEngine();
    engine.registerExams(DISCOVERED_EXAMS_DATASET);
    const index = engine.buildIndex();

    const fatecExam = index.exams.find((exam) => exam.institution === "FATEC" && exam.year === 2025);
    expect(fatecExam).toBeDefined();
    if (fatecExam) expect(convertExamToCatalogQuestions(fatecExam)).toEqual([]);
  });

  it("publishes only official reviewed or verified exam data", () => {
    const officialExam: DiscoveredExam = {
      id: "official-test-2025",
      institution: "TEST_UNI",
      examName: "Test 2025",
      year: 2025,
      phase: "first",
      status: "final",
      totalQuestions: 2,
      hasOfficialAnswerKey: true,
      hasExamDocument: true,
      examDocumentUrl: "https://example.edu/prova.pdf",
      aggregatorSourceId: "test-uni-official",
      sourceRole: "official",
      validationLevel: "reviewed",
      discoveredAt: "2026-09-08T00:00:00Z",
      questions: [
        { questionNumber: 1, correctAnswer: "A", subject: "Matemática" },
        { questionNumber: 2, correctAnswer: "B", subject: "Física" },
      ],
    };

    const catalogQuestions = convertExamToCatalogQuestions(officialExam);
    expect(catalogQuestions).toHaveLength(2);
    expect(catalogQuestions[0].providerId).toBe("testuni");
    expect(catalogQuestions[0].provenance.sourceRole).toBe("official");
    expect(catalogQuestions[0].provenance.validationLevel).toBe("reviewed");
  });

  it("fails closed when equal-authority sources disagree on an answer", () => {
    const engine = new DiscoveryEngine();
    engine.registerExams([
      {
        id: "test-source-1",
        institution: "TEST_UNI",
        examName: "Test 2025",
        year: 2025,
        status: "final",
        totalQuestions: 2,
        hasOfficialAnswerKey: true,
        hasExamDocument: true,
        aggregatorSourceId: "qconcursos",
        discoveredAt: "2026-09-08T00:00:00Z",
        questions: [
          { questionNumber: 1, correctAnswer: "A" },
          { questionNumber: 2, correctAnswer: "B" },
        ],
      },
      {
        id: "test-source-2",
        institution: "TEST_UNI",
        examName: "Test 2025",
        year: 2025,
        status: "final",
        totalQuestions: 2,
        hasOfficialAnswerKey: true,
        hasExamDocument: true,
        aggregatorSourceId: "kuadro",
        discoveredAt: "2026-09-08T00:00:00Z",
        questions: [
          { questionNumber: 1, correctAnswer: "C" },
          { questionNumber: 2, correctAnswer: "B" },
        ],
      },
    ]);

    const index = engine.buildIndex();
    expect(index.examsCount).toBe(0);
    expect(index.conflicts).toHaveLength(1);
    expect(index.conflicts[0].reason).toContain("Answer conflict on Q1");
  });

  it("fails closed when sources disagree on total question count", () => {
    const engine = new DiscoveryEngine();
    engine.registerExams([
      {
        id: "count-1",
        institution: "TEST_UNI",
        examName: "Test 2025",
        year: 2025,
        phase: "first",
        status: "final",
        totalQuestions: 71,
        hasOfficialAnswerKey: true,
        hasExamDocument: true,
        aggregatorSourceId: "qconcursos",
        discoveredAt: "2026-09-08T00:00:00Z",
      },
      {
        id: "count-2",
        institution: "TEST_UNI",
        examName: "Test 2025",
        year: 2025,
        phase: "first",
        status: "final",
        totalQuestions: 72,
        hasOfficialAnswerKey: true,
        hasExamDocument: true,
        aggregatorSourceId: "kuadro",
        discoveredAt: "2026-09-08T00:00:00Z",
      },
    ]);

    const index = engine.buildIndex();
    expect(index.examsCount).toBe(0);
    expect(index.conflicts[0].reason).toContain("Total questions mismatch");
  });

  it("gives a rectified answer key precedence over a final one", () => {
    const engine = new DiscoveryEngine();
    engine.registerExams([
      {
        id: "final",
        institution: "TEST_UNI",
        examName: "Test 2025",
        year: 2025,
        phase: "first",
        status: "final",
        totalQuestions: 1,
        hasOfficialAnswerKey: true,
        hasExamDocument: true,
        aggregatorSourceId: "qconcursos",
        discoveredAt: "2026-09-08T00:00:00Z",
        questions: [{ questionNumber: 1, correctAnswer: "A" }],
      },
      {
        id: "rectified",
        institution: "TEST_UNI",
        examName: "Test 2025",
        year: 2025,
        phase: "first",
        status: "rectified",
        totalQuestions: 1,
        hasOfficialAnswerKey: true,
        hasExamDocument: true,
        aggregatorSourceId: "kuadro",
        discoveredAt: "2026-09-08T01:00:00Z",
        questions: [{ questionNumber: 1, correctAnswer: "B" }],
      },
    ]);

    const index = engine.buildIndex();
    expect(index.exams).toHaveLength(1);
    expect(index.exams[0].status).toBe("rectified");
    expect(index.exams[0].questions?.[0].correctAnswer).toBe("B");
    expect(index.conflicts).toEqual([]);
  });

  it("does not accumulate old conflicts across repeated builds", () => {
    const engine = new DiscoveryEngine();
    engine.registerExams([
      {
        id: "a",
        institution: "TEST_UNI",
        examName: "Test 2025",
        year: 2025,
        status: "final",
        totalQuestions: 1,
        hasOfficialAnswerKey: true,
        hasExamDocument: true,
        aggregatorSourceId: "qconcursos",
        discoveredAt: "2026-09-08T00:00:00Z",
        questions: [{ questionNumber: 1, correctAnswer: "A" }],
      },
      {
        id: "b",
        institution: "TEST_UNI",
        examName: "Test 2025",
        year: 2025,
        status: "final",
        totalQuestions: 1,
        hasOfficialAnswerKey: true,
        hasExamDocument: true,
        aggregatorSourceId: "kuadro",
        discoveredAt: "2026-09-08T00:00:00Z",
        questions: [{ questionNumber: 1, correctAnswer: "B" }],
      },
    ]);

    expect(engine.buildIndex().conflicts).toHaveLength(1);
    expect(engine.buildIndex().conflicts).toHaveLength(1);
  });
});
