import { describe, expect, it } from "vitest";
import type { IngestionJobResult } from "./types";
import {
  buildReviewContentFingerprint,
  getApplicableReviewDecision,
  handoffReviewedJobToCatalog,
  InMemoryReviewDecisionStore,
  recordReviewDecision,
} from "./review";

function readyJob(overrides: Partial<IngestionJobResult> = {}): IngestionJobResult {
  const job: IngestionJobResult = {
    jobKey: "demo:2026:first:default",
    providerId: "demo",
    sourceId: "demo-source",
    editionId: "2026",
    year: 2026,
    phase: "first",
    status: "ready-for-review",
    rightsStatus: "allowed",
    statementMode: "structured",
    engineIssues: [],
    documentsDiscovered: 2,
    documentsFetched: 2,
    durationMs: 12,
    report: {
      providerId: "demo",
      sourceId: "demo-source",
      editionId: "2026",
      importerVersion: "demo@1.0.0",
      startedAt: "2026-09-12T12:00:00.000Z",
      documentsDiscovered: 2,
      documentsFetched: 2,
      objectiveExpected: 2,
      objectiveParsed: 2,
      answerKeysExpected: 2,
      answerKeysMatched: 2,
      annulled: [],
      unmatched: [],
      duplicates: [],
      subjects: { mathematics: 2 },
      validation: "provisional",
      issues: [],
    },
    stagedExam: {
      raw: {
        providerId: "demo",
        sourceId: "demo-source",
        editionId: "2026",
        year: 2026,
        phase: "first",
        importerVersion: "demo@1.0.0",
        fingerprints: [
          {
            url: "https://example.test/exam.pdf",
            contentLength: 100,
            sha256: "a".repeat(64),
            parserVersion: "demo@1.0.0",
            importedAt: "2026-09-12T12:00:00.000Z",
          },
          {
            url: "https://example.test/key.pdf",
            contentLength: 10,
            sha256: "b".repeat(64),
            parserVersion: "demo@1.0.0",
            importedAt: "2026-09-12T12:00:00.000Z",
          },
        ],
        parsedNumbers: [1, 2],
        answerKey: { 1: "A", 2: "B" },
        annulled: [],
        subjects: { mathematics: 2 },
        statementMode: "structured",
        extractionMethod: "api",
        rightsStatus: "allowed",
      },
      allowedLetters: ["A", "B", "C", "D", "E"],
      questions: [
        {
          number: 1,
          subject: "mathematics",
          statement: "Question one",
          alternatives: ["A", "B", "C", "D", "E"].map((id) => ({ id, text: id })),
        },
        {
          number: 2,
          subject: "mathematics",
          statement: "Question two",
          alternatives: ["A", "B", "C", "D", "E"].map((id) => ({ id, text: id })),
        },
      ],
      questionsMissingMedia: [],
      semanticFidelityIssues: [],
      warnings: [],
    },
  };
  return { ...job, ...overrides };
}

describe("ingestion human review state", () => {
  it("persists an approval bound to the exact staged content", async () => {
    const store = new InMemoryReviewDecisionStore();
    const job = readyJob();
    const decision = await recordReviewDecision(
      store,
      job,
      { disposition: "approved", validationLevel: "reviewed", reviewer: "reviewer-1" },
      () => new Date("2026-09-12T15:00:00.000Z"),
    );

    expect(decision.reviewedAt).toBe("2026-09-12T15:00:00.000Z");
    expect(await getApplicableReviewDecision(store, job)).toEqual(decision);

    const handoff = await handoffReviewedJobToCatalog(store, job);
    expect(handoff?.edition.validation).toBe("reviewed");
    expect(handoff?.edition.questionCount).toBe(2);
  });

  it("invalidates the decision when extracted content changes", async () => {
    const store = new InMemoryReviewDecisionStore();
    const job = readyJob();
    await recordReviewDecision(store, job, {
      disposition: "approved",
      validationLevel: "reviewed",
      reviewer: "reviewer-1",
    });

    const changed = readyJob();
    changed.stagedExam!.questions[0] = {
      ...changed.stagedExam!.questions[0],
      statement: "Corrected question one",
    };

    expect(await buildReviewContentFingerprint(changed)).not.toBe(
      await buildReviewContentFingerprint(job),
    );
    expect(await getApplicableReviewDecision(store, changed)).toBeNull();
    expect(await handoffReviewedJobToCatalog(store, changed)).toBeNull();
  });

  it("never promotes rejected or needs-changes review", async () => {
    for (const disposition of ["rejected", "needs-changes"] as const) {
      const store = new InMemoryReviewDecisionStore();
      const job = readyJob();
      await recordReviewDecision(store, job, { disposition, reviewer: "reviewer-1" });
      expect(await handoffReviewedJobToCatalog(store, job)).toBeNull();
    }
  });

  it("keeps a preliminary answer key provisional even after approval", async () => {
    const store = new InMemoryReviewDecisionStore();
    const job = readyJob();
    job.report!.issues.push({
      code: "preliminary-key-only",
      message: "final key not published yet",
      fatal: false,
    });

    await recordReviewDecision(store, job, {
      disposition: "approved",
      validationLevel: "verified",
      reviewer: "reviewer-1",
    });

    const handoff = await handoffReviewedJobToCatalog(store, job);
    expect(handoff?.edition.validation).toBe("provisional");
  });

  it("rejects review metadata that grants trust without approval", async () => {
    const store = new InMemoryReviewDecisionStore();
    await expect(
      recordReviewDecision(store, readyJob(), {
        disposition: "needs-changes",
        validationLevel: "reviewed",
        reviewer: "reviewer-1",
      }),
    ).rejects.toThrow(/only approved review/i);
  });
});
