import { describe, expect, it } from "vitest";
import type { DocumentFetcher } from "../../sources/ingestion";
import unespFixture from "../fixtures/unesp-2026.package.json";
import { parseCorpusPackageManifestV1 } from "../corpus";
import { IngestionEngine } from "../engine";
import { createReferenceCorpusAdapter } from "./referenceCorpusAdapter";

const enabled = process.env.RUN_CORPUS_NETWORK === "1";

const liveFetcher: DocumentFetcher = async (url) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": "StudiumLabsCorpusIntegration/1.0",
      accept: "application/pdf,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    url,
    bytes: new Uint8Array(await response.arrayBuffer()),
    headers: Object.fromEntries(response.headers.entries()),
  };
};

describe("UNESP 2026 live corpus integration", () => {
  (enabled ? it : it.skip)("downloads audited bytes and reaches ready-for-review with 90 questions", async () => {
    const manifest = parseCorpusPackageManifestV1(unespFixture);
    const adapter = createReferenceCorpusAdapter({
      providerId: "unesp",
      sourceId: "corpus-unesp",
      importerVersion: "corpus-unesp@1.0.0",
      manifest,
      rightsStatus: "permission-required",
    });

    const result = await new IngestionEngine().run([adapter], liveFetcher, {
      concurrency: 1,
      runId: "unesp-2026-live-proof",
      now: () => new Date("2026-09-13T00:00:00-03:00"),
    });

    expect(result.sourceFailures).toEqual([]);
    expect(result.skippedEditions).toEqual([]);
    expect(result.summary).toMatchObject({
      sources: 1,
      editionsDiscovered: 1,
      jobsPlanned: 1,
      readyForReview: 1,
      blocked: 0,
      documentsFetched: 2,
      questionsExtracted: 90,
    });
    expect(result.jobs[0]).toMatchObject({
      providerId: "unesp",
      editionId: "2026",
      phase: "first",
      variant: "v1",
      status: "ready-for-review",
      statementMode: "reference-only",
    });
    expect(result.jobs[0].stagedExam?.raw.fingerprints).toHaveLength(2);
    expect(result.jobs[0].stagedExam?.raw.answerKey[1]).toBe("E");
    expect(result.jobs[0].stagedExam?.raw.answerKey[90]).toBe("B");
    expect(result.reviewQueue).toHaveLength(1);
  }, 120_000);
});
