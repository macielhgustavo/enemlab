import { describe, expect, it } from "vitest";
import {
  createInventoryBackedDocumentFetcher,
  InMemoryContentAddressedDocumentStore,
  type AcquisitionTransport,
} from "./acquisition";
import { DocumentInventory } from "./documentInventory";

const URL = "https://servicos.nc.ufpr.br/documentos/ps2026/provas/definitivo/Geral.pdf";
const SOURCE_ID = "ufpr-nc-official";

function makeInventory(): DocumentInventory {
  const inventory = new DocumentInventory();
  inventory.observeEdition(
    SOURCE_ID,
    "UFPR",
    {
      editionId: "PS2026",
      year: 2026,
      label: "Processo Seletivo UFPR 2026",
      documents: [{ role: "objective-exam", url: URL, phase: "first" }],
    },
    "2026-09-10T20:00:00-03:00",
  );
  return inventory;
}

function okTransport(body: string, etag = '"v1"'): AcquisitionTransport {
  return async ({ url }) => ({
    url,
    status: 200,
    headers: {
      "content-type": "application/pdf",
      etag,
      "last-modified": "Thu, 10 Sep 2026 20:00:00 GMT",
    },
    bytes: new TextEncoder().encode(body),
  });
}

describe("content-addressed acquisition", () => {
  it("downloads a new document once, fingerprints it and stores bytes by SHA", async () => {
    const inventory = makeInventory();
    const blobStore = new InMemoryContentAddressedDocumentStore();
    const fetcher = createInventoryBackedDocumentFetcher({
      sourceId: SOURCE_ID,
      inventory,
      blobStore,
      transport: okTransport("pdf-v1"),
      allowedHosts: ["nc.ufpr.br"],
      now: () => new Date("2026-09-10T23:00:00Z"),
    });

    const fetched = await fetcher(URL);
    const record = inventory.findByUrl(SOURCE_ID, URL)[0];

    expect(new TextDecoder().decode(fetched.bytes)).toBe("pdf-v1");
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.etag).toBe('"v1"');
    expect(fetcher.stats).toMatchObject({
      logicalRequests: 1,
      networkRequests: 1,
      conditionalRequests: 0,
      downloadedDocuments: 1,
      newDocuments: 1,
      blobWrites: 1,
    });
    expect(await blobStore.get(record.sha256 ?? "missing")).not.toBeNull();
  });

  it("uses HTTP validators and cached bytes when the server returns 304", async () => {
    const inventory = makeInventory();
    const blobStore = new InMemoryContentAddressedDocumentStore();

    const first = createInventoryBackedDocumentFetcher({
      sourceId: SOURCE_ID,
      inventory,
      blobStore,
      transport: okTransport("pdf-v1"),
      allowedHosts: ["nc.ufpr.br"],
    });
    await first(URL);

    let receivedHeaders: Record<string, string> = {};
    const conditionalTransport: AcquisitionTransport = async ({ url, headers }) => {
      receivedHeaders = headers;
      return {
        url,
        status: 304,
        headers: { etag: '"v1"' },
      };
    };
    const second = createInventoryBackedDocumentFetcher({
      sourceId: SOURCE_ID,
      inventory,
      blobStore,
      transport: conditionalTransport,
      allowedHosts: ["nc.ufpr.br"],
    });

    const fetched = await second(URL);

    expect(receivedHeaders["if-none-match"]).toBe('"v1"');
    expect(receivedHeaders["if-modified-since"]).toBeDefined();
    expect(new TextDecoder().decode(fetched.bytes)).toBe("pdf-v1");
    expect(second.stats).toMatchObject({
      networkRequests: 1,
      conditionalRequests: 1,
      notModified: 1,
      downloadedDocuments: 0,
      downloadedBytes: 0,
      blobHits: 1,
    });
  });

  it("detects replacement bytes at the same URL and keeps both SHA blobs", async () => {
    const inventory = makeInventory();
    const blobStore = new InMemoryContentAddressedDocumentStore();
    const first = createInventoryBackedDocumentFetcher({
      sourceId: SOURCE_ID,
      inventory,
      blobStore,
      transport: okTransport("pdf-v1", '"v1"'),
      allowedHosts: ["nc.ufpr.br"],
    });
    await first(URL);
    const oldSha = inventory.findByUrl(SOURCE_ID, URL)[0].sha256 ?? "";

    const second = createInventoryBackedDocumentFetcher({
      sourceId: SOURCE_ID,
      inventory,
      blobStore,
      transport: okTransport("pdf-v2", '"v2"'),
      allowedHosts: ["nc.ufpr.br"],
    });
    await second(URL);
    const newSha = inventory.findByUrl(SOURCE_ID, URL)[0].sha256 ?? "";

    expect(newSha).not.toBe(oldSha);
    expect(second.stats.changedDocuments).toBe(1);
    expect(await blobStore.get(oldSha)).not.toBeNull();
    expect(await blobStore.get(newSha)).not.toBeNull();
  });

  it("does a full GET when metadata exists but the corresponding blob is missing", async () => {
    const inventory = makeInventory();
    inventory.recordFingerprint(SOURCE_ID, {
      url: URL,
      contentLength: 100,
      sha256: "a".repeat(64),
      etag: '"old"',
      parserVersion: "test@1",
      importedAt: "2026-09-10T22:00:00Z",
    });
    const blobStore = new InMemoryContentAddressedDocumentStore();

    let receivedHeaders: Record<string, string> = {};
    const transport: AcquisitionTransport = async ({ url, headers }) => {
      receivedHeaders = headers;
      return {
        url,
        status: 200,
        headers: { etag: '"new"' },
        bytes: new TextEncoder().encode("restored-body"),
      };
    };
    const fetcher = createInventoryBackedDocumentFetcher({
      sourceId: SOURCE_ID,
      inventory,
      blobStore,
      transport,
      allowedHosts: ["nc.ufpr.br"],
    });

    await fetcher(URL);

    expect(receivedHeaders).toEqual({});
    expect(fetcher.stats.blobMisses).toBeGreaterThanOrEqual(1);
    expect(fetcher.stats.downloadedDocuments).toBe(1);
  });

  it("coalesces duplicate logical requests for one physical URL in the same run", async () => {
    const inventory = makeInventory();
    const blobStore = new InMemoryContentAddressedDocumentStore();
    let calls = 0;
    const transport: AcquisitionTransport = async ({ url }) => {
      calls += 1;
      await Promise.resolve();
      return {
        url,
        status: 200,
        headers: {},
        bytes: new TextEncoder().encode("same-pdf"),
      };
    };
    const fetcher = createInventoryBackedDocumentFetcher({
      sourceId: SOURCE_ID,
      inventory,
      blobStore,
      transport,
      allowedHosts: ["nc.ufpr.br"],
    });

    const [left, right] = await Promise.all([fetcher(URL), fetcher(URL)]);

    expect(calls).toBe(1);
    expect(left.bytes).not.toBe(right.bytes);
    expect(fetcher.stats.logicalRequests).toBe(2);
    expect(fetcher.stats.coalescedRequests).toBe(1);
  });

  it("fails closed when an allowed URL redirects outside the source allowlist", async () => {
    const inventory = makeInventory();
    const fetcher = createInventoryBackedDocumentFetcher({
      sourceId: SOURCE_ID,
      inventory,
      blobStore: new InMemoryContentAddressedDocumentStore(),
      transport: async () => ({
        url: "https://evil.example/document.pdf",
        status: 200,
        headers: {},
        bytes: new Uint8Array([1, 2, 3]),
      }),
      allowedHosts: ["nc.ufpr.br"],
    });

    await expect(fetcher(URL)).rejects.toThrow(/redirected outside source allowlist/i);
    expect(fetcher.stats.failures).toBe(1);
    expect(inventory.findByUrl(SOURCE_ID, URL)[0].lastFetchError).toMatch(/outside/i);
  });
});
