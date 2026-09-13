import { describe, expect, it } from "vitest";
import type { DocumentFetcher } from "../../sources/ingestion";
import { IngestionEngine } from "../engine";
import { parseCorpusPackageManifestV1 } from "../corpus";
import { createReferenceCorpusAdapter } from "./referenceCorpusAdapter";

const EXAM_URL = "https://mirror.example/demo-prova.pdf";
const KEY_URL = "https://mirror.example/demo-gabarito.pdf";

function payload(over: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    package_id: "demo",
    collection: "demo",
    display_name: "Demo",
    source: "Official + mirror",
    generated_from: ["sources/demo.json"],
    exams: [
      {
        year: 2026,
        label: "Demo 2026",
        edition_id: "2026",
        phase: "first",
        variant: "v1",
        source_page: "https://official.example/demo-2026",
        expected_questions: 3,
        allowed_letters: ["A", "B", "C", "D", "E"],
        answer_key_status: "final",
        answer_key: { 1: "A", 2: "B", 3: "C" },
        files: [
          {
            kind: "prova",
            filename: "demo-prova.pdf",
            url: EXAM_URL,
            sha256: "6eae3afbe16b3ef6b1121ff278aaedd59c6c73bcda86ee6075a59ea316aff151",
            size_bytes: 7,
            authority: "mirror",
          },
          {
            kind: "gabarito",
            filename: "demo-gabarito.pdf",
            url: KEY_URL,
            sha256: "cd3373fb9eb03416816dce0b899611d509e06573dac6118fcbf2c926b647b3c0",
            size_bytes: 6,
            authority: "mirror",
            canonical_url: "https://official.example/demo-gabarito.pdf",
            canonical_authority: "official",
            verified_against_canonical: true,
          },
        ],
        ...over,
      },
    ],
  };
}

function fetcher(examBody = "exam-v1", keyBody = "key-v1"): DocumentFetcher {
  return async (url) => {
    const body = url === EXAM_URL ? examBody : url === KEY_URL ? keyBody : undefined;
    if (body === undefined) throw new Error("404");
    return {
      url,
      bytes: new TextEncoder().encode(body),
      headers: { "content-type": "application/pdf" },
    };
  };
}

function adapter(over: Record<string, unknown> = {}) {
  const manifest = parseCorpusPackageManifestV1(payload(over));
  return createReferenceCorpusAdapter({
    providerId: "demo",
    sourceId: "corpus-demo",
    importerVersion: "corpus-demo@1.0.0",
    manifest,
    rightsStatus: "permission-required",
  });
}

describe("createReferenceCorpusAdapter", () => {
  it("reaches ready-for-review without provider-specific engine code", async () => {
    const result = await new IngestionEngine().run([adapter()], fetcher(), {
      runId: "corpus-proof",
      now: () => new Date("2026-09-12T20:00:00-03:00"),
    });

    expect(result.summary).toMatchObject({
      sources: 1,
      editionsDiscovered: 1,
      jobsPlanned: 1,
      readyForReview: 1,
      blocked: 0,
      documentsFetched: 2,
      questionsExtracted: 3,
    });
    expect(result.jobs[0]).toMatchObject({
      status: "ready-for-review",
      providerId: "demo",
      editionId: "2026",
      phase: "first",
      variant: "v1",
      statementMode: "reference-only",
      rightsStatus: "permission-required",
    });
    expect(result.jobs[0].stagedExam?.raw.answerKey).toEqual({ 1: "A", 2: "B", 3: "C" });
    expect(result.reviewQueue[0].nativeContentCandidate).toBe(false);
  });

  it("fails closed when fetched bytes no longer match the corpus SHA", async () => {
    const result = await new IngestionEngine().run([adapter()], fetcher("exam-v2"));

    expect(result.jobs[0].status).toBe("blocked");
    expect(result.jobs[0].engineIssues[0].code).toBe("extract-failed");
    expect(result.jobs[0].engineIssues[0].message).toMatch(/SHA-256 mismatch/i);
    expect(result.reviewQueue).toEqual([]);
  });

  it("does not allow a corpus entry without normalized answer metadata", async () => {
    const result = await new IngestionEngine().run(
      [adapter({ answer_key: undefined, expected_questions: undefined })],
      fetcher(),
    );

    expect(result.summary.jobsPlanned).toBe(0);
    expect(result.skippedEditions).toHaveLength(1);
  });
});
