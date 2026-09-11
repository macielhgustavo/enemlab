import { describe, expect, it, vi } from "vitest";
import type {
  DiscoveredEdition,
  DocumentFetcher,
  DocumentFingerprint,
  ExamSourceDiscovery,
} from "../sources/ingestion";
import { IngestionEngine } from "./engine";
import type { ExtractedExamData, IngestionAdapter, IngestionPlan } from "./types";

const EXAM_URL = "https://example.edu/2025/prova.pdf";
const KEY_URL = "https://example.edu/2025/gabarito.pdf";

function edition(year = 2025): DiscoveredEdition {
  return {
    editionId: String(year),
    year,
    label: `Vestibular ${year}`,
    documents: [
      { role: "objective-exam", url: EXAM_URL, phase: "first" },
      { role: "answer-key", url: KEY_URL, phase: "first" },
    ],
  };
}

function planFor(value: DiscoveredEdition): IngestionPlan {
  return {
    editionId: value.editionId,
    year: value.year,
    phase: "first",
    expectedCount: 3,
    allowedLetters: ["A", "B", "C", "D", "E"],
    documents: value.documents,
  };
}

function extraction(over: Partial<ExtractedExamData> = {}): ExtractedExamData {
  return {
    questions: [1, 2, 3].map((number) => ({
      number,
      subject: "Matemática",
      statement: `Questão ${number}`,
      alternatives: ["A", "B", "C", "D", "E"].map((id) => ({
        id,
        text: `Alternativa ${id}`,
      })),
      confidence: 0.99,
    })),
    answerKey: { 1: "A", 2: "B", 3: "C" },
    ...over,
  };
}

function fetcher(contents: Record<string, string | undefined> = {}): DocumentFetcher {
  const source: Record<string, string | undefined> = {
    [EXAM_URL]: "exam-v1",
    [KEY_URL]: "key-v1",
    ...contents,
  };
  return async (url) => {
    const body = source[url];
    if (body === undefined) throw new Error("404");
    return {
      url,
      bytes: new TextEncoder().encode(body),
      headers: { "content-type": "application/pdf" },
    };
  };
}

function adapter(over: Partial<IngestionAdapter> = {}): IngestionAdapter {
  const discovered = edition();
  const discovery: ExamSourceDiscovery = {
    sourceId: "official-test",
    discover: async () => [discovered],
    isAllowed: () => true,
  };

  return {
    providerId: "test",
    sourceId: "official-test",
    importerVersion: "test@1.0.0",
    discovery,
    statementMode: "structured",
    extractionMethod: "pdf-text-layer",
    rightsStatus: "allowed",
    plan: (value) => [planFor(value)],
    extract: async () => extraction(),
    ...over,
  };
}

function fingerprintState(
  fingerprints: readonly DocumentFingerprint[],
): Record<string, DocumentFingerprint> {
  return Object.fromEntries(fingerprints.map((fingerprint) => [fingerprint.url, fingerprint]));
}

describe("IngestionEngine", () => {
  it("stages a complete extraction for review without publishing it", async () => {
    const result = await new IngestionEngine().run([adapter()], fetcher(), {
      runId: "test-run",
      now: () => new Date("2026-09-09T20:00:00-03:00"),
    });

    expect(result.runId).toBe("test-run");
    expect(result.summary).toMatchObject({
      sources: 1,
      editionsDiscovered: 1,
      jobsPlanned: 1,
      readyForReview: 1,
      blocked: 0,
      documentsFetched: 2,
      questionsExtracted: 3,
    });
    expect(result.jobs[0].status).toBe("ready-for-review");
    expect(result.jobs[0].report?.validation).toBe("provisional");
    expect(result.jobs[0].stagedExam?.raw.fingerprints).toHaveLength(2);
    expect(result.jobs[0].stagedExam?.raw.fingerprints[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.reviewQueue).toHaveLength(1);
    expect(result.reviewQueue[0].nativeContentCandidate).toBe(true);
  });

  it("keeps reference-only or non-allowed rights out of native-content candidacy", async () => {
    const result = await new IngestionEngine().run(
      [adapter({ rightsStatus: "official-reference", statementMode: "reference-only" })],
      fetcher(),
    );

    expect(result.jobs[0].status).toBe("ready-for-review");
    expect(result.reviewQueue[0].nativeContentCandidate).toBe(false);
    expect(result.reviewQueue[0].rightsStatus).toBe("official-reference");
  });

  it("allows reference-only ingestion with a complete answer key but no separate exam PDF", async () => {
    const referenceEdition: DiscoveredEdition = {
      editionId: "2025",
      year: 2025,
      label: "Vestibular 2025",
      documents: [{ role: "answer-key", url: KEY_URL, phase: "first" }],
    };
    const result = await new IngestionEngine().run(
      [
        adapter({
          rightsStatus: "official-reference",
          statementMode: "reference-only",
          discovery: {
            sourceId: "official-test",
            discover: async () => [referenceEdition],
            isAllowed: () => true,
          },
          plan: (value) => [planFor(value)],
          extract: async () =>
            extraction({
              questions: [1, 2, 3].map((number) => ({ number, subject: "Matemática" })),
            }),
        }),
      ],
      fetcher(),
    );

    expect(result.jobs[0].status).toBe("ready-for-review");
    expect(result.jobs[0].documentsFetched).toBe(1);
    expect(result.reviewQueue[0].nativeContentCandidate).toBe(false);
  });

  it("still blocks structured/native ingestion when the exam document is absent", async () => {
    const incompleteEdition: DiscoveredEdition = {
      editionId: "2025",
      year: 2025,
      label: "Vestibular 2025",
      documents: [{ role: "answer-key", url: KEY_URL, phase: "first" }],
    };
    const extract = vi.fn(async () => extraction());
    const result = await new IngestionEngine().run(
      [
        adapter({
          discovery: {
            sourceId: "official-test",
            discover: async () => [incompleteEdition],
            isAllowed: () => true,
          },
          plan: (value) => [planFor(value)],
          extract,
        }),
      ],
      fetcher(),
    );

    expect(result.jobs[0].status).toBe("blocked");
    expect(result.jobs[0].engineIssues[0].message).toContain("has no exam document");
    expect(extract).not.toHaveBeenCalled();
  });

  it("fails closed when extraction misses a question", async () => {
    const result = await new IngestionEngine().run(
      [
        adapter({
          extract: async () =>
            extraction({
              questions: extraction().questions.slice(0, 2),
              answerKey: { 1: "A", 2: "B" },
            }),
        }),
      ],
      fetcher(),
    );

    expect(result.jobs[0].status).toBe("blocked");
    expect(result.jobs[0].report?.issues.map((issue) => issue.code)).toContain("count-mismatch");
    expect(result.reviewQueue).toEqual([]);
  });

  it("fails closed when a required document cannot be fetched", async () => {
    const result = await new IngestionEngine().run(
      [adapter()],
      fetcher({ [KEY_URL]: undefined }),
    );

    expect(result.jobs[0].status).toBe("blocked");
    expect(result.jobs[0].engineIssues[0].code).toBe("fetch-failed");
    expect(result.jobs[0].report).toBeNull();
  });

  it("detects a silent upstream document change by SHA-256", async () => {
    const engine = new IngestionEngine();
    const first = await engine.run([adapter()], fetcher());
    const previous = fingerprintState(first.jobs[0].stagedExam?.raw.fingerprints ?? []);

    const second = await engine.run([adapter()], fetcher({ [EXAM_URL]: "exam-v2" }), {
      previousFingerprints: previous,
    });

    expect(second.jobs[0].status).toBe("blocked");
    expect(second.jobs[0].report?.issues.map((issue) => issue.code)).toContain(
      "document-changed",
    );
  });

  it("blocks duplicate logical plans instead of importing the same exam twice", async () => {
    const extract = vi.fn(async () => extraction());
    const value = adapter({
      plan: (discovered) => [planFor(discovered), planFor(discovered)],
      extract,
    });

    const result = await new IngestionEngine().run([value], fetcher());

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].status).toBe("blocked");
    expect(result.jobs[0].engineIssues[0].code).toBe("duplicate-job");
    expect(extract).not.toHaveBeenCalled();
  });

  it("respects the discovery allowlist before planning or downloading an edition", async () => {
    const plan = vi.fn((value: DiscoveredEdition) => [planFor(value)]);
    const value = adapter({
      discovery: {
        sourceId: "official-test",
        discover: async () => [edition()],
        isAllowed: () => false,
      },
      plan,
    });

    const result = await new IngestionEngine().run([value], fetcher());

    expect(result.jobs).toEqual([]);
    expect(result.summary.skippedNotAllowed).toBe(1);
    expect(plan).not.toHaveBeenCalled();
  });

  it("rejects malformed extraction confidence before canonical validation", async () => {
    const result = await new IngestionEngine().run(
      [
        adapter({
          extract: async () => {
            const data = extraction();
            data.questions[0].confidence = 1.1;
            return data;
          },
        }),
      ],
      fetcher(),
    );

    expect(result.jobs[0].status).toBe("blocked");
    expect(result.jobs[0].engineIssues[0].code).toBe("invalid-extraction");
    expect(result.jobs[0].report).toBeNull();
  });
});
