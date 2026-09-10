import { describe, expect, it, vi } from "vitest";
import type { IngestionAdapter, IngestionExtractionContext } from "./types";
import {
  buildExtractionCheckpointKey,
  InMemoryExtractionCheckpointStore,
  withExtractionCheckpointCache,
} from "./checkpoint";

function context(sha = "a".repeat(64)): IngestionExtractionContext {
  return {
    plan: {
      editionId: "2025",
      year: 2025,
      phase: "first",
      expectedCount: 1,
      allowedLetters: ["A", "B"],
      documents: [
        { role: "objective-exam", url: "https://example.test/prova.pdf" },
        { role: "answer-key", url: "https://example.test/gabarito.pdf" },
      ],
    },
    documents: [
      {
        definition: { role: "objective-exam", url: "https://example.test/prova.pdf" },
        fetched: { url: "https://example.test/prova.pdf", bytes: new Uint8Array([1]), headers: {} },
        fingerprint: {
          url: "https://example.test/prova.pdf",
          contentLength: 1,
          sha256: sha,
          parserVersion: "adapter@1",
          importedAt: "2026-09-10T00:00:00.000Z",
        },
      },
      {
        definition: { role: "answer-key", url: "https://example.test/gabarito.pdf" },
        fetched: { url: "https://example.test/gabarito.pdf", bytes: new Uint8Array([2]), headers: {} },
        fingerprint: {
          url: "https://example.test/gabarito.pdf",
          contentLength: 1,
          sha256: "b".repeat(64),
          parserVersion: "adapter@1",
          importedAt: "2026-09-10T00:00:00.000Z",
        },
      },
    ],
  };
}

function adapter(version = "adapter@1"): IngestionAdapter {
  return {
    providerId: "teste",
    sourceId: "teste-oficial",
    importerVersion: version,
    discovery: {
      sourceId: "teste-oficial",
      async discover() {
        return [];
      },
      isAllowed() {
        return true;
      },
    },
    statementMode: "structured",
    extractionMethod: "pdf-text-layer",
    rightsStatus: "allowed",
    async plan() {
      return [];
    },
    extract: vi.fn(async () => ({
      questions: [
        {
          number: 1,
          statement: "Enunciado",
          alternatives: [
            { id: "A", text: "A" },
            { id: "B", text: "B" },
          ],
        },
      ],
      answerKey: { 1: "A" },
    })),
  };
}

describe("extraction checkpoint cache", () => {
  it("reuses extraction only for the exact document hashes and importer version", async () => {
    const base = adapter();
    const store = new InMemoryExtractionCheckpointStore();
    const cached = withExtractionCheckpointCache(base, store, () => new Date("2026-09-10T00:00:00Z"));

    const first = await cached.extract(context());
    first.questions[0].statement = "mutated";
    const second = await cached.extract(context());

    expect(base.extract).toHaveBeenCalledTimes(1);
    expect(second.questions[0].statement).toBe("Enunciado");
    expect(cached.checkpointStats).toMatchObject({ hits: 1, misses: 1, writes: 1 });
  });

  it("invalidates when the official document bytes change at the same URL", async () => {
    const base = adapter();
    const store = new InMemoryExtractionCheckpointStore();
    const cached = withExtractionCheckpointCache(base, store);

    await cached.extract(context("a".repeat(64)));
    await cached.extract(context("c".repeat(64)));

    expect(base.extract).toHaveBeenCalledTimes(2);
    expect(cached.checkpointStats.hits).toBe(0);
    expect(cached.checkpointStats.misses).toBe(2);
  });

  it("includes importer version in the cache key", () => {
    expect(buildExtractionCheckpointKey(adapter("adapter@1"), context())).not.toBe(
      buildExtractionCheckpointKey(adapter("adapter@2"), context()),
    );
  });

  it("treats cache outages as performance degradation instead of ingestion failure", async () => {
    const base = adapter();
    const cached = withExtractionCheckpointCache(base, {
      async get() {
        throw new Error("read unavailable");
      },
      async set() {
        throw new Error("write unavailable");
      },
    });

    await expect(cached.extract(context())).resolves.toMatchObject({ answerKey: { 1: "A" } });
    expect(base.extract).toHaveBeenCalledTimes(1);
    expect(cached.checkpointStats).toMatchObject({
      hits: 0,
      misses: 1,
      readErrors: 1,
      writeErrors: 1,
    });
  });
});
