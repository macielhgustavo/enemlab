import { describe, expect, it } from "vitest";
import type { DocumentFetcher } from "../sources/ingestion";
import { InMemoryDocumentInventoryStore } from "./documentInventory";
import { runSourceHarvest } from "./harvestRunner";
import type { OfficialSourceRecipe } from "./sourceRecipe";

const recipe: OfficialSourceRecipe = {
  sourceId: "test-source",
  institution: "TEST",
  archiveUrls: ["https://test.edu/archive"],
  allowedHosts: ["test.edu"],
  edition: { year: /(?:^|\D)(20\d{2})(?:\D|$)/ },
  documents: [
    { role: "answer-key", match: /gabarito/i },
    { role: "objective-exam", match: /prova/i },
  ],
};

function makeFetcher(html: string): DocumentFetcher {
  return async (url) => ({
    url,
    bytes: new TextEncoder().encode(html),
    headers: { "content-type": "text/html" },
  });
}

describe("runSourceHarvest", () => {
  it("persists discovered documents and preserves old ones on later runs", async () => {
    const store = new InMemoryDocumentInventoryStore();
    let tick = 0;
    const now = () => new Date(`2026-09-${String(10 + tick++).padStart(2, "0")}T12:00:00Z`);

    const first = await runSourceHarvest(
      [recipe],
      makeFetcher(`
        <a href="/2024/prova.pdf">Prova 2024</a>
        <a href="/2024/gabarito.pdf">Gabarito 2024</a>
      `),
      store,
      { now },
    );

    expect(first.summary.inventoryDocuments).toBe(2);

    const second = await runSourceHarvest(
      [recipe],
      makeFetcher(`
        <a href="/2025/prova.pdf">Prova 2025</a>
        <a href="/2025/gabarito.pdf">Gabarito 2025</a>
      `),
      store,
      { now },
    );

    expect(second.summary.editionsDiscovered).toBe(1);
    expect(second.summary.matchedDocuments).toBe(2);
    expect(second.summary.inventoryDocuments).toBe(4);
    expect(second.inventory.records.map((record) => record.year).sort()).toEqual([2024, 2024, 2025, 2025]);
  });

  it("does not erase inventory when a source temporarily fails", async () => {
    const store = new InMemoryDocumentInventoryStore({
      version: 1,
      records: [
        {
          key: "known",
          sourceId: "test-source",
          institution: "TEST",
          editionId: "2024",
          year: 2024,
          role: "objective-exam",
          url: "https://test.edu/2024/prova.pdf",
          firstSeenAt: "2026-09-09T12:00:00Z",
          lastSeenAt: "2026-09-09T12:00:00Z",
          sightings: 1,
          fetchCount: 0,
        },
      ],
    });

    const failingFetcher: DocumentFetcher = async () => {
      throw new Error("site unavailable");
    };

    const result = await runSourceHarvest([recipe], failingFetcher, store, {
      now: () => new Date("2026-09-10T12:00:00Z"),
    });

    expect(result.summary.sourceIssues).toBe(1);
    expect(result.summary.inventoryDocuments).toBe(1);
    expect(result.inventory.records[0].url).toBe("https://test.edu/2024/prova.pdf");
  });
});
