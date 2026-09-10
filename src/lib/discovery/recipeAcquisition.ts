import type {
  DiscoveredEdition,
  DocumentFetcher,
  ExamSourceDiscovery,
  FetchedDocument,
} from "../sources/ingestion";
import {
  createInventoryBackedDocumentFetcher,
  type AcquisitionStats,
  type AcquisitionTransport,
  type ContentAddressedDocumentStore,
} from "./acquisition";
import {
  DocumentInventory,
  type DocumentInventoryStore,
} from "./documentInventory";
import {
  createRecipeDiscovery,
  type OfficialSourceRecipe,
} from "./sourceRecipe";

export interface RecipeAcquisitionBridge {
  inventory: DocumentInventory;
  discovery: ExamSourceDiscovery;
  fetcher: DocumentFetcher;
  readonly acquisitionStats: AcquisitionStats;
  persist(): Promise<void>;
}

export interface OpenRecipeAcquisitionBridgeOptions {
  recipe: OfficialSourceRecipe;
  inventoryStore: DocumentInventoryStore;
  blobStore: ContentAddressedDocumentStore;
  transport: AcquisitionTransport;
  maxBytes?: number;
  now?: () => Date;
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

function hostAllowed(url: string, allowedHosts: readonly string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowedHosts.some((allowed) => {
      const canonical = allowed.toLowerCase();
      return host === canonical || host.endsWith(`.${canonical}`);
    });
  } catch {
    return false;
  }
}

/**
 * Opens one end-to-end source session without changing IngestionEngine's
 * existing DocumentFetcher signature.
 *
 * Before discovery has registered a URL, the fetcher behaves as a plain,
 * allowlisted HTTP fetcher so archive/index pages can be crawled. Once a recipe
 * returns editions, their documents are inserted into the same mutable
 * inventory. The very next engine fetch for those URLs is therefore routed
 * through content-addressed acquisition automatically.
 */
export async function openRecipeAcquisitionBridge(
  options: OpenRecipeAcquisitionBridgeOptions,
): Promise<RecipeAcquisitionBridge> {
  const { recipe, inventoryStore, blobStore, transport } = options;
  const now = options.now ?? (() => new Date());
  const inventory = new DocumentInventory(await inventoryStore.load());
  const recipeDiscovery = createRecipeDiscovery(recipe);
  const acquisitionFetcher = createInventoryBackedDocumentFetcher({
    sourceId: recipe.sourceId,
    inventory,
    blobStore,
    transport,
    allowedHosts: recipe.allowedHosts,
    maxBytes: options.maxBytes,
    now,
  });

  const discovery: ExamSourceDiscovery = {
    sourceId: recipe.sourceId,
    async discover(fetcher): Promise<DiscoveredEdition[]> {
      const editions = await recipeDiscovery.discover(fetcher);
      const seenAt = now().toISOString();
      for (const edition of editions) {
        inventory.observeEdition(recipe.sourceId, recipe.institution, edition, seenAt);
      }
      return editions;
    },
    isAllowed: recipeDiscovery.isAllowed,
  };

  const plainFetch = async (url: string): Promise<FetchedDocument> => {
    if (!hostAllowed(url, recipe.allowedHosts)) {
      throw new Error(`discovery fetch URL is outside source allowlist: ${url}`);
    }
    const response = await transport({ url, headers: {} });
    if (!hostAllowed(response.url, recipe.allowedHosts)) {
      throw new Error(`discovery fetch redirected outside source allowlist: ${response.url}`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${url}: discovery fetch returned HTTP ${response.status}`);
    }
    if (!response.bytes) {
      throw new Error(`${url}: discovery fetch returned no body`);
    }
    return {
      url: response.url || url,
      bytes: new Uint8Array(response.bytes),
      headers: normalizeHeaders(response.headers),
    };
  };

  const fetcher: DocumentFetcher = async (url) => {
    if (inventory.findByUrl(recipe.sourceId, url).length > 0) {
      return acquisitionFetcher(url);
    }
    return plainFetch(url);
  };

  return {
    inventory,
    discovery,
    fetcher,
    acquisitionStats: acquisitionFetcher.stats,
    async persist() {
      await inventoryStore.save(inventory.snapshot());
    },
  };
}
