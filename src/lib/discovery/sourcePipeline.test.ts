import { describe, expect, it, vi } from "vitest";
import type { AcquisitionTransport } from "./acquisition";
import { InMemoryContentAddressedDocumentStore } from "./acquisition";
import { InMemoryDocumentInventoryStore } from "./documentInventory";
import { InMemoryExtractionCheckpointStore } from "../ingestion/checkpoint";
import type { IngestionAdapter } from "../ingestion/types";
import { runSourcePipeline } from "./sourcePipeline";
import type { OfficialSourceRecipe } from "./sourceRecipe";

const ARCHIVE = "https://test.edu/archive";
const EXAM = "https://test.edu/2025/prova.pdf";
const KEY = "https://test.edu/2025/gabarito.pdf";

const recipe: OfficialSourceRecipe = {
  sourceId: "test-source",
  institution: "TEST",
  archiveUrls: [ARCHIVE],
  allowedHosts: ["test.edu"],
  edition: { year: /(?:^|\D)(20\d{2})(?:\D|$)/ },
  documents: [
    { role: "answer-key", match: /gabarito/i, phase: "first" },
    { role: "objective-exam", match: /prova/i, phase: "first" },
  ],
};

function transport(): AcquisitionTransport {
  const bodies: Record<string, string> = {
    [EXAM]: "exam-v1",
    [KEY]: "key-v1",
  };
  return async ({ url, headers }) => {
    if (url === ARCHIVE) {
      return {
        url,
        status: 200,
        headers: { "content-type": "text/html" },
        bytes: new TextEncoder().encode(
          `<a href="${EXAM}">Prova 2025</a><a href="${KEY}">Gabarito 2025</a>`,
        ),
      };
    }
    const body = bodies[url];
    if (!body) return { url, status: 404, headers: {} };
    const etag = `"${body}"`;
    if (headers["if-none-match"] === etag) {
      return { url, status: 304, headers: { etag } };
    }
    return {
      url,
      status: 200,
      headers: { "content-type": "application/pdf", etag },
      bytes: new TextEncoder().encode(body),
    };
  };
}

function adapter(extract: IngestionAdapter["extract"]): IngestionAdapter {
  return {
    providerId: "test",
    sourceId: "test-source",
    importerVersion: "test-source@1",
    discovery: {
      sourceId: "test-source",
      discover: async () => [],
      isAllowed: () => false,
    },
    statementMode: "structured",
    extractionMethod: "pdf-text-layer",
    rightsStatus: "allowed",
    plan: (edition) => [
      {
        editionId: edition.editionId,
        year: edition.year,
        phase: "first",
        expectedCount: 1,
        allowedLetters: ["A", "B"],
        documents: edition.documents,
      },
    ],
    extract,
  };
}

describe("runSourcePipeline", () => {
  it("turns the second acquisition-only run into a zero-body warm fetch", async () => {
    const inventoryStore = new InMemoryDocumentInventoryStore();
    const blobStore = new InMemoryContentAddressedDocumentStore();
    const network = transport();

    const first = await runSourcePipeline(
      { recipe },
      { inventoryStore, blobStore, transport: network, concurrency: 2 },
    );
    const second = await runSourcePipeline(
      { recipe },
      { inventoryStore, blobStore, transport: network, concurrency: 2 },
    );

    expect(first.report.mode).toBe("acquisition-only");
    expect(first.report.cacheState).toBe("cold");
    expect(first.report.discovery.uniqueDocumentUrls).toBe(2);
    expect(first.report.acquisition.downloadedDocuments).toBe(2);
    expect(first.report.documentFailures).toEqual([]);

    expect(second.report.cacheState).toBe("warm");
    expect(second.report.acquisition.notModified).toBe(2);
    expect(second.report.acquisition.downloadedDocuments).toBe(0);
    expect(second.report.acquisition.downloadedBytes).toBe(0);
  });

  it("automatically upgrades to ingestion and reuses the extraction checkpoint", async () => {
    const inventoryStore = new InMemoryDocumentInventoryStore();
    const blobStore = new InMemoryContentAddressedDocumentStore();
    const checkpointStore = new InMemoryExtractionCheckpointStore();
    const network = transport();
    const extract = vi.fn(async () => ({
      questions: [
        {
          number: 1,
          statement: "Questão 1",
          alternatives: [
            { id: "A", text: "A" },
            { id: "B", text: "B" },
          ],
        },
      ],
      answerKey: { 1: "A" },
    }));
    const definition = { recipe, adapter: adapter(extract) };

    const first = await runSourcePipeline(definition, {
      inventoryStore,
      blobStore,
      checkpointStore,
      transport: network,
    });
    const second = await runSourcePipeline(definition, {
      inventoryStore,
      blobStore,
      checkpointStore,
      transport: network,
    });

    expect(first.report.mode).toBe("ingestion");
    expect(first.report.ingestion?.summary.readyForReview).toBe(1);
    expect(first.report.checkpoint?.misses).toBe(1);
    expect(second.report.checkpoint?.hits).toBe(1);
    expect(second.report.acquisition.notModified).toBe(2);
    expect(extract).toHaveBeenCalledTimes(1);
  });
});
