import { describe, expect, it } from "vitest";
import type { DocumentFetcher } from "../../sources/ingestion";
import { IngestionEngine } from "../engine";
import { createFuvestManifestAdapter } from "./fuvestManifestAdapter";

const fakePdfFetcher: DocumentFetcher = async (url) => ({
  url,
  bytes: new TextEncoder().encode(`fixture:${url}`),
  headers: { "content-type": "application/pdf" },
});

describe("FUVEST ingestion adapter", () => {
  it("turns the reviewed historical manifest into one plan per accepted edition", async () => {
    const adapter = createFuvestManifestAdapter();
    const editions = await adapter.discovery.discover(fakePdfFetcher);

    expect(editions).toHaveLength(22);
    expect(editions.every((edition) => adapter.discovery.isAllowed(edition))).toBe(true);

    const plans = (
      await Promise.all(editions.map((edition) => Promise.resolve(adapter.plan(edition))))
    ).flat();

    expect(plans).toHaveLength(22);
    expect(plans.reduce((total, plan) => total + plan.expectedCount, 0)).toBe(2000);
    expect(plans.every((plan) => plan.documents.length >= 1)).toBe(true);

    const edition2022 = editions.find((edition) => edition.year === 2022);
    expect(edition2022?.documents.map((document) => document.role)).toEqual(["answer-key"]);
  });

  it("runs all 22 editions / 2,000 references through the generic engine in one batch", async () => {
    const result = await new IngestionEngine().run(
      [createFuvestManifestAdapter()],
      fakePdfFetcher,
      { concurrency: 8, runId: "fuvest-volume-fixture" },
    );

    expect(result.summary).toMatchObject({
      sources: 1,
      editionsDiscovered: 22,
      jobsPlanned: 22,
      readyForReview: 22,
      blocked: 0,
      questionsExtracted: 2000,
    });
    expect(result.jobs.every((job) => job.report?.validation === "provisional")).toBe(true);
    expect(result.reviewQueue).toHaveLength(22);
    expect(result.reviewQueue.every((item) => item.nativeContentCandidate === false)).toBe(true);
    expect(result.reviewQueue.every((item) => item.rightsStatus === "official-reference")).toBe(true);
  });
});
