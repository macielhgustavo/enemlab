import type { DocumentFetcher } from "../sources/ingestion";
import {
  DocumentInventory,
  type DocumentInventorySnapshot,
  type DocumentInventoryStore,
} from "./documentInventory";
import {
  harvestOfficialSource,
  type HarvestResult,
  type OfficialSourceRecipe,
} from "./sourceRecipe";

export interface HarvestRunnerResult {
  startedAt: string;
  finishedAt: string;
  sources: HarvestResult[];
  inventory: DocumentInventorySnapshot;
  summary: {
    recipes: number;
    successfulSources: number;
    sourceIssues: number;
    editionsDiscovered: number;
    matchedDocuments: number;
    inventoryDocuments: number;
  };
}

export interface HarvestRunnerOptions {
  now?: () => Date;
}

/**
 * Runs declarative source discovery and persists the union of all documents ever seen.
 *
 * A failed archive page never erases older inventory entries. This is intentional:
 * transient official-site outages should reduce freshness, not destroy knowledge.
 */
export async function runSourceHarvest(
  recipes: readonly OfficialSourceRecipe[],
  fetcher: DocumentFetcher,
  store: DocumentInventoryStore,
  options: HarvestRunnerOptions = {},
): Promise<HarvestRunnerResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const inventory = new DocumentInventory(await store.load());
  const sources: HarvestResult[] = [];

  for (const recipe of recipes) {
    const result = await harvestOfficialSource(recipe, fetcher);
    sources.push(result);
    const seenAt = now().toISOString();
    for (const edition of result.editions) {
      inventory.observeEdition(recipe.sourceId, recipe.institution, edition, seenAt);
    }
  }

  const snapshot = inventory.snapshot();
  await store.save(snapshot);
  const finishedAt = now().toISOString();

  return {
    startedAt,
    finishedAt,
    sources,
    inventory: snapshot,
    summary: {
      recipes: recipes.length,
      successfulSources: sources.filter((source) => source.pagesFetched > 0).length,
      sourceIssues: sources.reduce((total, source) => total + source.issues.length, 0),
      editionsDiscovered: sources.reduce((total, source) => total + source.editions.length, 0),
      matchedDocuments: sources.reduce((total, source) => total + source.matchedDocuments, 0),
      inventoryDocuments: snapshot.records.length,
    },
  };
}
