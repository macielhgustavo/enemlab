import { describe, expect, it, vi } from "vitest";
import type {
  DiscoveredEdition,
  DocumentFetcher,
  ExamSourceDiscovery,
} from "../sources/ingestion";
import { IngestionEngine } from "./engine";
import {
  assessSemanticFidelity,
  buildSelectiveFallbackRequest,
  mergeSelectiveFallback,
} from "./semanticFidelity";
import type { ExtractedExamData, IngestionAdapter } from "./types";

const EXAM_URL = "https://example.edu/prova.pdf";
const KEY_URL = "https://example.edu/gabarito.pdf";
const LETTERS = ["A", "B", "C", "D", "E"];

function question(number: number, statement = `Questão ${number}`) {
  return {
    number,
    page: number + 1,
    statement,
    alternatives: LETTERS.map((id) => ({ id, text: `Alternativa ${id}` })),
  };
}

function extraction(): ExtractedExamData {
  return {
    questions: [question(1), question(2), question(3)],
    answerKey: { 1: "A", 2: "B", 3: "C" },
  };
}

function edition(): DiscoveredEdition {
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

const fetcher: DocumentFetcher = async (url) => ({
  url,
  bytes: new TextEncoder().encode(url),
  headers: { "content-type": "application/pdf" },
});

function adapter(primary: ExtractedExamData, overrides: Partial<IngestionAdapter> = {}): IngestionAdapter {
  const discovery: ExamSourceDiscovery = {
    sourceId: "semantic-test",
    discover: async () => [edition()],
    isAllowed: () => true,
  };

  return {
    providerId: "semantic",
    sourceId: "semantic-test",
    importerVersion: "semantic@1",
    discovery,
    statementMode: "structured",
    extractionMethod: "pdf-text-layer",
    rightsStatus: "allowed",
    plan: (value) => [
      {
        editionId: value.editionId,
        year: value.year,
        phase: "first",
        expectedCount: 3,
        allowedLetters: LETTERS,
        documents: value.documents,
      },
    ],
    extract: async () => primary,
    ...overrides,
  };
}

describe("semantic fidelity gate", () => {
  it("detects machine-verifiable text corruption without pretending to validate formulas", () => {
    const data = extraction();
    data.questions[1].statement = "A potência é 10� W";

    const issues = assessSemanticFidelity(data);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "replacement-character",
          severity: "error",
          questionNumber: 2,
          field: "statement",
        }),
      ]),
    );
  });

  it("fails closed when extractor metadata points to identities that do not exist", () => {
    const data = extraction();
    data.questionsMissingMedia = [999];
    data.semanticFidelityIssues = [
      {
        code: "layout-ambiguity",
        severity: "warning",
        questionNumber: 998,
        message: "referência inválida",
      },
    ];

    const issues = assessSemanticFidelity(data);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "extractor-reported",
          severity: "error",
          message: expect.stringContaining("questão inexistente"),
        }),
      ]),
    );
    expect(buildSelectiveFallbackRequest(data, LETTERS).targets).toEqual([]);
  });

  it("builds exception-driven targets for structure, media and semantic failures", () => {
    const data = extraction();
    data.questions[0].alternatives = data.questions[0].alternatives?.slice(0, 4);
    data.questionsMissingMedia = [2];
    data.semanticFidelityIssues = [
      {
        code: "formula-ambiguity",
        severity: "error",
        questionNumber: 3,
        page: 4,
        message: "expoente não pôde ser verificado",
      },
    ];

    const request = buildSelectiveFallbackRequest(data, LETTERS);

    expect(request.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ questionNumber: 1, reason: "incomplete-structure" }),
        expect.objectContaining({ questionNumber: 2, reason: "missing-media" }),
        expect.objectContaining({ questionNumber: 3, reason: "semantic-fidelity" }),
      ]),
    );
  });

  it("refuses a fallback that tries to rewrite an unrelated question", () => {
    const primary = extraction();
    const request = {
      targets: [
        {
          questionNumber: 2,
          page: 3,
          reason: "semantic-fidelity" as const,
          message: "corrompida",
        },
      ],
    };

    expect(() =>
      mergeSelectiveFallback(primary, { questions: [question(1, "reescrita indevida")] }, request),
    ).toThrow("unrequested question 1");
  });

  it("preserves missing-media state until fallback explicitly resolves it", () => {
    const primary = extraction();
    primary.questionsMissingMedia = [2];
    const request = {
      targets: [
        {
          questionNumber: 2,
          page: 3,
          reason: "missing-media" as const,
          message: "imagem pendente",
        },
      ],
    };

    const stillPending = mergeSelectiveFallback(
      primary,
      { questions: [question(2, "texto reextraído")] },
      request,
    );
    expect(stillPending.questionsMissingMedia).toEqual([2]);

    const resolved = mergeSelectiveFallback(
      primary,
      { questions: [question(2, "texto e mídia conferidos")], resolvedMissingMedia: [2] },
      request,
    );
    expect(resolved.questionsMissingMedia).toEqual([]);
  });

  it("does not clear a page-wide semantic issue by replacing only one question on that page", () => {
    const primary = extraction();
    primary.questions[0].page = 2;
    primary.questions[1].page = 2;
    primary.semanticFidelityIssues = [
      {
        code: "layout-ambiguity",
        severity: "error",
        page: 2,
        message: "duas colunas perderam associação",
      },
    ];
    const request = {
      targets: [
        {
          questionNumber: 1,
          page: 2,
          reason: "semantic-fidelity" as const,
          message: "reextrair questão 1",
        },
      ],
    };

    const merged = mergeSelectiveFallback(
      primary,
      { questions: [{ ...question(1, "questão 1 limpa"), page: 2 }] },
      request,
    );

    expect(merged.semanticFidelityIssues).toEqual(primary.semanticFidelityIssues);
  });

  it("keeps a structurally valid but semantically unsafe exam out of native candidacy", async () => {
    const primary = extraction();
    primary.questions[1].statement = "Valor = 3�10²";

    const result = await new IngestionEngine().run([adapter(primary)], fetcher);

    expect(result.jobs[0].status).toBe("ready-for-review");
    expect(result.reviewQueue[0]).toMatchObject({
      structurallyCompleteQuestions: 3,
      contentReadyQuestions: 3,
      semanticFidelityReadyQuestions: 2,
      questionsNeedingFallback: 1,
      nativeContentCandidate: false,
    });
    expect(result.summary.semanticFidelityReadyQuestions).toBe(2);
  });

  it("calls fallback only for targeted exceptions and restores candidacy after a clean replacement", async () => {
    const primary = extraction();
    primary.questions[1].statement = "Valor = 3�10²";
    const fallbackExtract = vi.fn(async (_context, request) => {
      expect(request.targets).toEqual([
        expect.objectContaining({ questionNumber: 2, reason: "semantic-fidelity" }),
      ]);
      return { questions: [question(2, "Valor = 3 × 10²")] };
    });

    const result = await new IngestionEngine().run(
      [adapter(primary, { fallbackExtract })],
      fetcher,
    );

    expect(fallbackExtract).toHaveBeenCalledTimes(1);
    expect(result.reviewQueue[0]).toMatchObject({
      semanticFidelityReadyQuestions: 3,
      questionsNeedingFallback: 0,
      nativeContentCandidate: true,
    });
    expect(result.reviewQueue[0].fallback).toEqual({
      targetCount: 1,
      replacedQuestions: [2],
    });
    expect(result.summary).toMatchObject({
      fallbackAttempts: 1,
      fallbackReplacements: 1,
    });
  });
});
