import { describe, expect, it, vi } from "vitest";
import type { DocumentFetcher } from "../../sources/ingestion";
import { fuvestAnswerKey } from "../../providers/fuvest";
import { IngestionEngine } from "../engine";
import {
  createExternalExtractionEnvelope,
  createExternalExtractionFailureEnvelope,
} from "../protocol";
import type { ExtractedExamData } from "../types";
import { createFuvestExternalAdapter } from "./fuvestExternalAdapter";

const fetcher: DocumentFetcher = async (url) => ({
  url,
  bytes: new TextEncoder().encode(`fixture:${url}`),
  headers: { "content-type": "application/pdf" },
});

function extractionFor(year: number, count: number): ExtractedExamData {
  const entry = fuvestAnswerKey(year);
  if (!entry) throw new Error(`missing FUVEST ${year}`);

  return {
    questions: Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      subject: "Conhecimentos gerais",
      statement: `Questão ${index + 1}`,
      alternatives: ["A", "B", "C", "D", "E"].map((id) => ({
        id,
        text: `Alternativa ${id}`,
      })),
      sourceDocumentUrl: entry.examUrl ?? undefined,
    })),
    answerKey: Object.fromEntries(
      Object.entries(entry.answers).map(([number, answer]) => [Number(number), answer]),
    ),
    annulled: [...entry.annulled],
    subjects: { "Conhecimentos gerais": count },
  };
}

describe("FUVEST external extraction adapter", () => {
  it("runs every reviewed edition that has an official canonical exam PDF", async () => {
    const adapter = createFuvestExternalAdapter(async (context) =>
      createExternalExtractionEnvelope(
        context,
        { providerId: "fuvest", sourceId: "fuvest-archive" },
        { name: "fixture", version: "1" },
        extractionFor(context.plan.year, context.plan.expectedCount),
      ),
    );

    const result = await new IngestionEngine().run([adapter], fetcher, {
      concurrency: 8,
      runId: "fuvest-external-fixture",
    });

    expect(result.summary.editionsDiscovered).toBe(22);
    expect(result.summary.jobsPlanned).toBe(21);
    expect(result.summary.readyForReview).toBe(21);
    expect(result.summary.questionsExtracted).toBe(1910);
    expect(result.summary.skippedNotAllowed).toBe(1);
    expect(result.skippedEditions).toEqual([
      expect.objectContaining({ providerId: "fuvest", editionId: "2022" }),
    ]);
    expect(result.reviewQueue.every((item) => item.nativeContentCandidate === false)).toBe(true);
  });

  it("routes a SHA-bound failure envelope to recovery using only declared targets", async () => {
    const recovery = vi.fn(async (context, request) => {
      expect(request.targets).toEqual([
        expect.objectContaining({ page: 7, reason: "incomplete-structure" }),
      ]);
      return createExternalExtractionEnvelope(
        context,
        { providerId: "fuvest", sourceId: "fuvest-archive" },
        { name: "ocr-fixture", version: "1" },
        extractionFor(context.plan.year, context.plan.expectedCount),
      );
    });

    const adapter = createFuvestExternalAdapter(
      async (context) =>
        createExternalExtractionFailureEnvelope(
          context,
          { providerId: "fuvest", sourceId: "fuvest-archive" },
          { name: "pdf-text", version: "1" },
          "question boundaries unavailable on one page",
          {
            targets: [
              {
                page: 7,
                reason: "incomplete-structure",
                message: "numeric boundary glyphs missing",
              },
            ],
          },
        ),
      recovery,
    );

    const result = await new IngestionEngine().run([adapter], fetcher, {
      concurrency: 8,
    });

    expect(recovery).toHaveBeenCalledTimes(21);
    expect(result.summary.readyForReview).toBe(21);
    expect(result.summary.blocked).toBe(0);
    expect(result.summary.questionsExtracted).toBe(1910);
  });

  it("rejects a payload whose document SHA does not match the engine download", async () => {
    const adapter = createFuvestExternalAdapter(async (context) => {
      const envelope = createExternalExtractionEnvelope(
        context,
        { providerId: "fuvest", sourceId: "fuvest-archive" },
        { name: "fixture", version: "1" },
        extractionFor(context.plan.year, context.plan.expectedCount),
      );
      envelope.documents[0].sha256 = "0".repeat(64);
      return envelope;
    });

    const result = await new IngestionEngine().run([adapter], fetcher, {
      concurrency: 8,
    });

    expect(result.jobs).toHaveLength(21);
    expect(result.jobs.every((job) => job.status === "blocked")).toBe(true);
    expect(result.jobs.every((job) => job.engineIssues[0]?.code === "extract-failed")).toBe(true);
    expect(result.reviewQueue).toEqual([]);
  });
});
