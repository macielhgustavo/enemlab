import { describe, expect, it } from "vitest";
import {
  buildExceptionReductionPlan,
  clusterExceptionObservations,
  normalizeExceptionMessage,
  routeRepairStrategies,
  type ExceptionObservation,
} from "./exceptionReducer";
import type { IngestionJobResult } from "./types";

function observation(over: Partial<ExceptionObservation> = {}): ExceptionObservation {
  return {
    id: "obs-1",
    fingerprint:
      "fuvest|fuvest-archive|glyph-private-use|statement|texto contem glifo unicode de uso privado sem semantica portavel garantida",
    providerId: "fuvest",
    sourceId: "fuvest-archive",
    editionId: "2015",
    year: 2015,
    phase: "first",
    importerVersion: "fuvest@1",
    questionNumber: 10,
    page: 3,
    reason: "semantic-fidelity",
    rootCause: "glyph-private-use",
    fieldScope: "statement",
    message: "texto contém glifo Unicode de uso privado sem semântica portável garantida",
    ...over,
  };
}

function stagedJob(): IngestionJobResult {
  return {
    jobKey: "fuvest:2015:first:default",
    providerId: "fuvest",
    sourceId: "fuvest-archive",
    editionId: "2015",
    year: 2015,
    phase: "first",
    status: "ready-for-review",
    rightsStatus: "official-reference",
    statementMode: "reference-only",
    engineIssues: [],
    report: null,
    documentsDiscovered: 2,
    documentsFetched: 2,
    durationMs: 10,
    stagedExam: {
      raw: {
        providerId: "fuvest",
        sourceId: "fuvest-archive",
        editionId: "2015",
        year: 2015,
        phase: "first",
        importerVersion: "fuvest@1",
        fingerprints: [],
        parsedNumbers: [1, 2],
        answerKey: { 1: "A", 2: "B" },
        annulled: [],
        subjects: {},
        statementMode: "reference-only",
        extractionMethod: "pdf-text-layer",
        rightsStatus: "official-reference",
      },
      allowedLetters: ["A", "B"],
      questions: [
        {
          number: 1,
          page: 2,
          statement: "Questão completa",
          alternatives: [
            { id: "A", text: "A" },
            { id: "B", text: "B" },
          ],
        },
        {
          number: 2,
          page: 3,
          statement: "Questão com glifo \uE000",
          alternatives: [{ id: "A", text: "A" }],
        },
      ],
      questionsMissingMedia: [1],
      semanticFidelityIssues: [],
      warnings: [],
    },
  };
}

describe("exception reducer", () => {
  it("normalizes volatile numbers, URLs and digests in recurring messages", () => {
    expect(
      normalizeExceptionMessage(
        "Questão 17 falhou em https://example.test/a.pdf hash aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ).toBe("questão # falhou em <url> hash <digest>");
  });

  it("clusters the same root cause across editions instead of per question", () => {
    const first = observation();
    const second = observation({
      id: "obs-2",
      editionId: "2016",
      year: 2016,
      questionNumber: 42,
      page: 8,
    });
    const clusters = clusterExceptionObservations([first, second]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      affectedEditions: 2,
      affectedQuestions: 2,
      rootCause: "glyph-private-use",
    });
    expect(clusters[0].repairRoute[0].strategyId).toBe("font-map-recovery");
  });

  it("keeps different causes in different clusters", () => {
    const clusters = clusterExceptionObservations([
      observation(),
      observation({
        id: "obs-2",
        fingerprint: "fuvest|fuvest-archive|media-unbound|media|questao depende de midia ainda nao associada",
        rootCause: "media-unbound",
        fieldScope: "media",
        reason: "missing-media",
        message: "questão depende de mídia ainda não associada",
      }),
    ]);

    expect(clusters).toHaveLength(2);
  });

  it("routes repairs from cheaper deterministic/parser layers toward human review", () => {
    const route = routeRepairStrategies({
      rootCause: "layout-ambiguity",
      occurrenceCount: 120,
      affectedQuestions: 100,
      affectedPages: 25,
    });

    expect(route.map((step) => step.tier)).toEqual([
      "alternate-parser",
      "geometry",
      "local-ocr",
      "vision",
      "llm",
      "human",
    ]);
    expect(route[0].estimatedBatches).toBe(1);
    expect(route.at(-1)?.strategyId).toBe("human-review");
  });

  it("never routes control glyphs through blind cleanup", () => {
    const route = routeRepairStrategies({
      rootCause: "glyph-control",
      occurrenceCount: 629,
      affectedQuestions: 530,
      affectedPages: 180,
    });

    expect(route.map((step) => step.strategyId)).toEqual([
      "font-map-recovery",
      "local-ocr-region",
      "vision-region",
      "llm-structured-repair",
      "human-review",
    ]);
    expect(route.some((step) => step.strategyId.includes("cleanup"))).toBe(false);
  });

  it("builds a cross-job plan from actual staged structural, media and semantic failures", () => {
    const plan = buildExceptionReductionPlan([stagedJob()]);

    expect(plan.metrics.affectedQuestions).toBe(2);
    expect(plan.metrics.rootCauseCounts).toMatchObject({
      "structure-incomplete": 1,
      "media-unbound": 1,
      "glyph-private-use": 1,
    });
    expect(plan.clusters.map((cluster) => cluster.rootCause)).toEqual(
      expect.arrayContaining(["structure-incomplete", "media-unbound", "glyph-private-use"]),
    );
  });
});
