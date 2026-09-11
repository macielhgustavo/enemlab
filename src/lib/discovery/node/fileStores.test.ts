import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileContentAddressedDocumentStore,
  FileDocumentInventoryStore,
  FileExtractionCheckpointStore,
} from "./fileStores";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "enemlab-source-store-"));
}

describe("filesystem source stores", () => {
  it("persists document inventory between store instances", async () => {
    const root = await temporaryDirectory();
    try {
      const path = join(root, "inventory.json");
      const first = new FileDocumentInventoryStore(path);
      await first.save({
        version: 1,
        records: [
          {
            key: "known",
            sourceId: "test-source",
            institution: "TEST",
            editionId: "2025",
            year: 2025,
            role: "objective-exam",
            url: "https://test.edu/prova.pdf",
            firstSeenAt: "2026-09-10T00:00:00Z",
            lastSeenAt: "2026-09-10T00:00:00Z",
            sightings: 1,
            fetchCount: 0,
          },
        ],
      });

      const second = new FileDocumentInventoryStore(path);
      expect(await second.load()).toMatchObject({
        version: 1,
        records: [{ editionId: "2025", url: "https://test.edu/prova.pdf" }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stores blobs by SHA and detects corruption on read", async () => {
    const root = await temporaryDirectory();
    try {
      const store = new FileContentAddressedDocumentStore(root);
      const bytes = new TextEncoder().encode("official-pdf-v1");
      const sha256 = digest("official-pdf-v1");
      await store.put({ sha256, bytes });

      const reloaded = new FileContentAddressedDocumentStore(root);
      expect(new TextDecoder().decode((await reloaded.get(sha256))?.bytes)).toBe(
        "official-pdf-v1",
      );

      const path = join(root, "sha256", sha256.slice(0, 2), `${sha256}.bin`);
      await writeFile(path, "corrupt");
      await expect(reloaded.get(sha256)).rejects.toThrow(/corrupt/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists extraction checkpoints without exposing cache keys as filenames", async () => {
    const root = await temporaryDirectory();
    try {
      const store = new FileExtractionCheckpointStore(root);
      const key = "provider:edition:https://official.example/prova.pdf";
      await store.set({
        key,
        providerId: "test",
        sourceId: "test-source",
        editionId: "2025",
        importerVersion: "test@1",
        documentShas: { "https://official.example/prova.pdf": "a".repeat(64) },
        extraction: {
          questions: [{ number: 1 }],
          answerKey: { 1: "A" },
        },
        createdAt: "2026-09-10T00:00:00Z",
      });

      const loaded = await new FileExtractionCheckpointStore(root).get(key);
      expect(loaded?.key).toBe(key);
      expect(loaded?.extraction.answerKey).toEqual({ 1: "A" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
