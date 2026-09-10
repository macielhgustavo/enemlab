import { describe, expect, it } from "vitest";
import { DocumentInventory, JsonDocumentInventoryStore } from "./documentInventory";

describe("DocumentInventory", () => {
  it("remembers discovered documents independently from extraction", () => {
    const inventory = new DocumentInventory();
    inventory.observeEdition(
      "test-source",
      "TEST",
      {
        editionId: "2025",
        year: 2025,
        label: "TEST 2025",
        documents: [
          { role: "objective-exam", url: "https://test.edu/2025/prova.pdf", phase: "first" },
          { role: "answer-key", url: "https://test.edu/2025/gabarito.pdf", phase: "first" },
        ],
      },
      "2026-09-10T12:00:00Z",
    );

    const snapshot = inventory.snapshot();
    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.records.every((record) => record.sightings === 1)).toBe(true);
    expect(snapshot.records.every((record) => record.fetchCount === 0)).toBe(true);
  });

  it("increments sightings instead of duplicating an already-known URL", () => {
    const inventory = new DocumentInventory();
    const edition = {
      editionId: "2025",
      year: 2025,
      label: "TEST 2025",
      documents: [{ role: "objective-exam" as const, url: "https://test.edu/2025/prova.pdf" }],
    };

    inventory.observeEdition("test-source", "TEST", edition, "2026-09-10T12:00:00Z");
    inventory.observeEdition("test-source", "TEST", edition, "2026-09-11T12:00:00Z");

    expect(inventory.snapshot().records).toHaveLength(1);
    expect(inventory.snapshot().records[0].sightings).toBe(2);
    expect(inventory.snapshot().records[0].lastSeenAt).toBe("2026-09-11T12:00:00Z");
  });

  it("records a fetched SHA and metadata on every matching logical document", () => {
    const inventory = new DocumentInventory();
    inventory.observeEdition(
      "test-source",
      "TEST",
      {
        editionId: "2025",
        year: 2025,
        label: "TEST 2025",
        documents: [{ role: "objective-exam", url: "https://test.edu/shared.pdf", phase: "first" }],
      },
      "2026-09-10T12:00:00Z",
    );

    inventory.recordFingerprint("test-source", {
      url: "https://test.edu/shared.pdf",
      contentLength: 123,
      sha256: "A".repeat(64),
      etag: '"abc"',
      parserVersion: "inventory-test@1",
      importedAt: "2026-09-10T12:01:00Z",
    });

    const record = inventory.snapshot().records[0];
    expect(record.fetchCount).toBe(1);
    expect(record.sha256).toBe("a".repeat(64));
    expect(record.contentLength).toBe(123);
    expect(record.etag).toBe('"abc"');
  });

  it("round-trips through a JSON-backed store", async () => {
    let persisted: string | null = null;
    const store = new JsonDocumentInventoryStore(
      async () => persisted,
      async (value) => {
        persisted = value;
      },
    );
    const inventory = new DocumentInventory();
    inventory.observeEdition(
      "test-source",
      "TEST",
      {
        editionId: "2025",
        year: 2025,
        label: "TEST 2025",
        documents: [{ role: "answer-key", url: "https://test.edu/gabarito-2025.pdf" }],
      },
      "2026-09-10T12:00:00Z",
    );

    await store.save(inventory.snapshot());
    const reloaded = new DocumentInventory(await store.load());
    expect(reloaded.snapshot()).toEqual(inventory.snapshot());
  });
});
