import { describe, expect, it } from "vitest";
import {
  InMemoryContentAddressedDocumentStore,
  type AcquisitionTransport,
} from "./acquisition";
import { InMemoryDocumentInventoryStore } from "./documentInventory";
import { openRecipeAcquisitionBridge } from "./recipeAcquisition";
import type { OfficialSourceRecipe } from "./sourceRecipe";

const ARCHIVE = "https://vest.test.edu.br/archive";
const PDF = "https://vest.test.edu.br/2025/prova.pdf";

const recipe: OfficialSourceRecipe = {
  sourceId: "test-official",
  institution: "TEST",
  archiveUrls: [ARCHIVE],
  allowedHosts: ["vest.test.edu.br"],
  minYear: 2025,
  maxYear: 2025,
  edition: { year: /(?:^|\D)(2025)(?:\D|$)/ },
  documents: [
    { role: ["objective-exam", "answer-key"], match: /prova\.pdf/i, phase: "first" },
  ],
};

describe("recipe acquisition bridge", () => {
  it("uses plain fetch for discovery and cached acquisition after the document enters inventory", async () => {
    const inventoryStore = new InMemoryDocumentInventoryStore();
    const blobStore = new InMemoryContentAddressedDocumentStore();
    const requests: { url: string; headers: Record<string, string> }[] = [];
    const transport: AcquisitionTransport = async ({ url, headers }) => {
      requests.push({ url, headers });
      if (url === ARCHIVE) {
        return {
          url,
          status: 200,
          headers: { "content-type": "text/html" },
          bytes: new TextEncoder().encode(`<a href="${PDF}">Prova 2025</a>`),
        };
      }
      if (url === PDF) {
        return {
          url,
          status: 200,
          headers: { "content-type": "application/pdf", etag: '"pdf-v1"' },
          bytes: new TextEncoder().encode("pdf-v1"),
        };
      }
      throw new Error(`unexpected ${url}`);
    };

    const bridge = await openRecipeAcquisitionBridge({
      recipe,
      inventoryStore,
      blobStore,
      transport,
    });

    const editions = await bridge.discovery.discover(bridge.fetcher);
    expect(editions).toHaveLength(1);
    expect(bridge.inventory.findByUrl(recipe.sourceId, PDF)).toHaveLength(2);
    expect(bridge.acquisitionStats.networkRequests).toBe(0);

    const fetched = await bridge.fetcher(PDF);
    expect(new TextDecoder().decode(fetched.bytes)).toBe("pdf-v1");
    expect(bridge.acquisitionStats.networkRequests).toBe(1);
    expect(bridge.acquisitionStats.newDocuments).toBe(1);
    expect(requests).toHaveLength(2);

    await bridge.persist();
    const persisted = await inventoryStore.load();
    expect(persisted?.records.every((record) => record.sha256)).toBe(true);
  });

  it("reuses the persisted blob through a 304 on the next source session", async () => {
    const inventoryStore = new InMemoryDocumentInventoryStore();
    const blobStore = new InMemoryContentAddressedDocumentStore();

    const firstTransport: AcquisitionTransport = async ({ url }) => {
      if (url === ARCHIVE) {
        return {
          url,
          status: 200,
          headers: { "content-type": "text/html" },
          bytes: new TextEncoder().encode(`<a href="${PDF}">Prova 2025</a>`),
        };
      }
      return {
        url,
        status: 200,
        headers: { etag: '"pdf-v1"', "content-type": "application/pdf" },
        bytes: new TextEncoder().encode("pdf-v1"),
      };
    };
    const first = await openRecipeAcquisitionBridge({
      recipe,
      inventoryStore,
      blobStore,
      transport: firstTransport,
    });
    await first.discovery.discover(first.fetcher);
    await first.fetcher(PDF);
    await first.persist();

    let conditionalHeader: string | undefined;
    const secondTransport: AcquisitionTransport = async ({ url, headers }) => {
      if (url === ARCHIVE) {
        return {
          url,
          status: 200,
          headers: { "content-type": "text/html" },
          bytes: new TextEncoder().encode(`<a href="${PDF}">Prova 2025</a>`),
        };
      }
      conditionalHeader = headers["if-none-match"];
      return { url, status: 304, headers: { etag: '"pdf-v1"' } };
    };
    const second = await openRecipeAcquisitionBridge({
      recipe,
      inventoryStore,
      blobStore,
      transport: secondTransport,
    });
    await second.discovery.discover(second.fetcher);
    const fetched = await second.fetcher(PDF);

    expect(conditionalHeader).toBe('"pdf-v1"');
    expect(new TextDecoder().decode(fetched.bytes)).toBe("pdf-v1");
    expect(second.acquisitionStats.notModified).toBe(1);
    expect(second.acquisitionStats.downloadedBytes).toBe(0);
  });
});
