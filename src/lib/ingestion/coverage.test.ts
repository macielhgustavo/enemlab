import { describe, expect, it } from "vitest";
import type {
  DiscoveredEdition,
  DocumentFetcher,
  ExamSourceDiscovery,
} from "../sources/ingestion";
import { IngestionEngine } from "./engine";
import type { ExtractedExamData, IngestionAdapter } from "./types";

const EXAM_URL = "https://example.test/prova.pdf";
const KEY_URL = "https://example.test/gabarito.pdf";

const fetcher: DocumentFetcher = async (url) => ({
  url,
  bytes: new TextEncoder().encode(url),
  headers: { "content-type": "application/pdf" },
});

function discovered(): DiscoveredEdition {
  return {
    editionId: "2026",
    year: 2026,
    label: "Teste 2026",
    documents: [
      { role: "objective-exam", url: EXAM_URL, phase: "first" },
      { role: "answer-key", url: KEY_URL, phase: "first" },
    ],
  };
}

function question(number: number) {
  return {
    number,
    statement: `Questão ${number}`,
    alternatives: ["A", "B", "C", "D", "E"].map((id) => ({
      id,
      text: `Alternativa ${id}`,
    })),
  };
}

function adapter(extraction: ExtractedExamData): IngestionAdapter {
  const discovery: ExamSourceDiscovery = {
    sourceId: "coverage-test",
    discover: async () => [discovered()],
    isAllowed: () => true,
  };

  return {
    providerId: "coverage",
    sourceId: "coverage-test",
    importerVersion: "coverage@1",
    discovery,
    statementMode: "structured",
    extractionMethod: "pdf-text-layer",
    rightsStatus: "allowed",
    plan: (edition) => [
      {
        editionId: edition.editionId,
        year: edition.year,
        phase: "first",
        expectedCount: 3,
        allowedLetters: ["A", "B", "C", "D", "E"],
        documents: edition.documents,
      },
    ],
    extract: async () => extraction,
  };
}

function completeExtraction(): ExtractedExamData {
  return {
    questions: [question(1), question(2), question(3)],
    answerKey: { 1: "A", 2: "B", 3: "C" },
    subjects: { Geral: 3 },
  };
}

describe("ingestion extraction coverage", () => {
  it("keeps missing media out of content-ready and native candidacy", async () => {
    const extraction = completeExtraction();
    extraction.questionsMissingMedia = [2];

    const result = await new IngestionEngine().run([adapter(extraction)], fetcher);

    expect(result.summary).toMatchObject({
      questionsExtracted: 3,
      structurallyCompleteQuestions: 3,
      contentReadyQuestions: 2,
      questionsMissingMedia: 1,
    });
    expect(result.reviewQueue[0]).toMatchObject({
      structurallyCompleteQuestions: 3,
      contentReadyQuestions: 2,
      questionsMissingMedia: 1,
      nativeContentCandidate: false,
    });
  });

  it("does not count incomplete alternative structure as content-ready", async () => {
    const extraction = completeExtraction();
    extraction.questions[1].alternatives = extraction.questions[1].alternatives?.slice(0, 4);

    const result = await new IngestionEngine().run([adapter(extraction)], fetcher);

    expect(result.summary.structurallyCompleteQuestions).toBe(2);
    expect(result.summary.contentReadyQuestions).toBe(2);
    expect(result.reviewQueue[0].nativeContentCandidate).toBe(false);
  });

  it("marks a fully structured allowed exam as a native review candidate only", async () => {
    const result = await new IngestionEngine().run(
      [adapter(completeExtraction())],
      fetcher,
    );

    expect(result.summary.contentReadyQuestions).toBe(3);
    expect(result.reviewQueue[0].nativeContentCandidate).toBe(true);
    expect(result.jobs[0].report?.validation).toBe("provisional");
  });
});
