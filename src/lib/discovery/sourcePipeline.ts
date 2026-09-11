import type { DocumentFingerprint } from "../sources/ingestion";
import {
  type ExtractionCheckpointStats,
  type ExtractionCheckpointStore,
  withExtractionCheckpointCache,
} from "../ingestion/checkpoint";
import { mapWithConcurrency } from "../ingestion/concurrency";
import { IngestionEngine } from "../ingestion/engine";
import type { IngestionAdapter, IngestionRunResult } from "../ingestion/types";
import type {
  AcquisitionStats,
  AcquisitionTransport,
  ContentAddressedDocumentStore,
} from "./acquisition";
import type {
  DocumentInventorySnapshot,
  DocumentInventoryStore,
} from "./documentInventory";
import { openRecipeAcquisitionBridge } from "./recipeAcquisition";
import {
  createRecipeDiscovery,
  harvestOfficialSource,
  type HarvestIssue,
  type OfficialSourceRecipe,
} from "./sourceRecipe";

export interface SourcePipelineDefinition {
  recipe: OfficialSourceRecipe;
  /**
   * Optional until a source has a trustworthy extractor. Without an adapter the
   * runner stops after acquisition instead of pretending the source is ingested.
   */
  adapter?: IngestionAdapter;
}

export interface SourcePipelineOptions {
  inventoryStore: DocumentInventoryStore;
  blobStore: ContentAddressedDocumentStore;
  transport: AcquisitionTransport;
  checkpointStore?: ExtractionCheckpointStore;
  concurrency?: number;
  maxBytes?: number;
  runId?: string;
  now?: () => Date;
}

export type SourcePipelineMode = "acquisition-only" | "ingestion";
export type SourcePipelineCacheState = "cold" | "warm" | "mixed";

export interface SourcePipelineDocumentFailure {
  url: string;
  message: string;
}

export interface SourcePipelineReport {
  version: 1;
  sourceId: string;
  institution: string;
  mode: SourcePipelineMode;
  cacheState: SourcePipelineCacheState;
  startedAt: string;
  finishedAt: string;
  discovery: {
    editionsDiscovered: number;
    logicalDocumentsDiscovered: number;
    uniqueDocumentUrls: number;
    harvestIssues: HarvestIssue[];
  };
  acquisition: AcquisitionStats;
  documentFailures: SourcePipelineDocumentFailure[];
  checkpoint?: ExtractionCheckpointStats;
  ingestion?: {
    runId: string;
    summary: IngestionRunResult["summary"];
    sourceFailures: IngestionRunResult["sourceFailures"];
    skippedEditions: IngestionRunResult["skippedEditions"];
    jobs: Array<{
      jobKey: string;
      status: string;
      editionId: string;
      year: number;
      phase: string;
      variant?: string;
      documentsDiscovered: number;
      documentsFetched: number;
      questionCount: number;
      validation: string | null;
      engineIssues: string[];
    }>;
  };
}

export interface SourcePipelineRunResult {
  report: SourcePipelineReport;
  /** Present only when the source has an adapter and the ingestion engine ran. */
  ingestion?: IngestionRunResult;
}

function previousFingerprints(
  snapshot: DocumentInventorySnapshot,
): Record<string, DocumentFingerprint> {
  const output: Record<string, DocumentFingerprint> = {};
  for (const record of snapshot.records) {
    if (!record.sha256 || record.contentLength === undefined || !record.fetchedAt) continue;
    const existing = output[record.url];
    if (existing && existing.sha256.toLowerCase() !== record.sha256.toLowerCase()) {
      throw new Error(`inventory has conflicting SHA-256 values for ${record.url}`);
    }
    output[record.url] = {
      url: record.url,
      contentLength: record.contentLength,
      sha256: record.sha256.toLowerCase(),
      etag: record.etag,
      lastModified: record.lastModified,
      parserVersion: "acquisition-inventory@1",
      importedAt: record.fetchedAt,
    };
  }
  return output;
}

function cacheStateForUrls(
  urls: readonly string[],
  previous: Record<string, DocumentFingerprint>,
): SourcePipelineCacheState {
  if (!urls.length) return Object.keys(previous).length ? "warm" : "cold";
  const cached = urls.filter((url) => Boolean(previous[url])).length;
  if (cached === 0) return "cold";
  if (cached === urls.length) return "warm";
  return "mixed";
}

function fetchIssueUrl(message: string): string {
  const separator = message.indexOf(": ");
  return separator > 0 ? message.slice(0, separator) : "unknown";
}

function compactIngestion(result: IngestionRunResult): NonNullable<SourcePipelineReport["ingestion"]> {
  return {
    runId: result.runId,
    summary: result.summary,
    sourceFailures: result.sourceFailures,
    skippedEditions: result.skippedEditions,
    jobs: result.jobs.map((job) => ({
      jobKey: job.jobKey,
      status: job.status,
      editionId: job.editionId,
      year: job.year,
      phase: job.phase,
      variant: job.variant,
      documentsDiscovered: job.documentsDiscovered,
      documentsFetched: job.documentsFetched,
      questionCount: job.stagedExam?.questions.length ?? 0,
      validation: job.report?.validation ?? null,
      engineIssues: job.engineIssues.map((issue) => `${issue.stage}:${issue.code}:${issue.message}`),
    })),
  };
}

/**
 * End-to-end source runner.
 *
 * Sources without an extraction adapter still get a useful, durable pipeline:
 * discover official documents, acquire each unique URL, fingerprint by SHA and
 * persist validators/blobs. Once an adapter is supplied, the exact same runner
 * replaces its discovery with the recipe bridge and executes IngestionEngine,
 * optionally with a persistent extraction checkpoint store.
 */
export async function runSourcePipeline(
  definition: SourcePipelineDefinition,
  options: SourcePipelineOptions,
): Promise<SourcePipelineRunResult> {
  const { recipe } = definition;
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("source pipeline concurrency must be a positive integer");
  }
  if (definition.adapter && definition.adapter.sourceId !== recipe.sourceId) {
    throw new Error(
      `adapter sourceId ${definition.adapter.sourceId} does not match recipe ${recipe.sourceId}`,
    );
  }

  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const bridge = await openRecipeAcquisitionBridge({
    recipe,
    inventoryStore: options.inventoryStore,
    blobStore: options.blobStore,
    transport: options.transport,
    maxBytes: options.maxBytes,
    now,
  });
  const before = previousFingerprints(bridge.inventory.snapshot());

  let result: SourcePipelineRunResult;
  try {
    if (!definition.adapter) {
      const harvest = await harvestOfficialSource(recipe, bridge.fetcher);
      const allow = createRecipeDiscovery(recipe);
      const seenAt = now().toISOString();
      for (const edition of harvest.editions) {
        if (!allow.isAllowed(edition)) continue;
        bridge.inventory.observeEdition(recipe.sourceId, recipe.institution, edition, seenAt);
      }

      const editions = harvest.editions.filter((edition) => allow.isAllowed(edition));
      const logicalDocumentsDiscovered = editions.reduce(
        (total, edition) => total + edition.documents.length,
        0,
      );
      const urls = [
        ...new Set(
          editions.flatMap((edition) => edition.documents.map((document) => document.url)),
        ),
      ];
      const failures = await mapWithConcurrency(urls, concurrency, async (url) => {
        try {
          await bridge.fetcher(url);
          return null;
        } catch (error) {
          return {
            url,
            message: error instanceof Error ? error.message : String(error),
          } satisfies SourcePipelineDocumentFailure;
        }
      });
      const documentFailures = failures.filter(
        (failure): failure is SourcePipelineDocumentFailure => failure !== null,
      );

      result = {
        report: {
          version: 1,
          sourceId: recipe.sourceId,
          institution: recipe.institution,
          mode: "acquisition-only",
          cacheState: cacheStateForUrls(urls, before),
          startedAt,
          finishedAt: now().toISOString(),
          discovery: {
            editionsDiscovered: editions.length,
            logicalDocumentsDiscovered,
            uniqueDocumentUrls: urls.length,
            harvestIssues: harvest.issues,
          },
          acquisition: { ...bridge.acquisitionStats },
          documentFailures,
        },
      };
    } else {
      const adapterWithRecipeDiscovery: IngestionAdapter = {
        ...definition.adapter,
        discovery: bridge.discovery,
      };
      const checkpointed = options.checkpointStore
        ? withExtractionCheckpointCache(adapterWithRecipeDiscovery, options.checkpointStore, now)
        : null;
      const adapter = checkpointed ?? adapterWithRecipeDiscovery;
      const ingestion = await new IngestionEngine().run([adapter], bridge.fetcher, {
        concurrency,
        now,
        runId: options.runId,
        previousFingerprints: before,
      });
      const documentFailures = ingestion.jobs.flatMap((job) =>
        job.engineIssues
          .filter((issue) => issue.code === "fetch-failed")
          .map((issue) => ({ url: fetchIssueUrl(issue.message), message: issue.message })),
      );
      const logicalDocumentsDiscovered = ingestion.jobs.reduce(
        (total, job) => total + job.documentsDiscovered,
        0,
      );
      const uniqueDocumentUrls = Math.max(
        0,
        bridge.acquisitionStats.logicalRequests - bridge.acquisitionStats.coalescedRequests,
      );

      result = {
        ingestion,
        report: {
          version: 1,
          sourceId: recipe.sourceId,
          institution: recipe.institution,
          mode: "ingestion",
          cacheState: Object.keys(before).length ? "warm" : "cold",
          startedAt,
          finishedAt: now().toISOString(),
          discovery: {
            editionsDiscovered: ingestion.summary.editionsDiscovered,
            logicalDocumentsDiscovered,
            uniqueDocumentUrls,
            harvestIssues: [],
          },
          acquisition: { ...bridge.acquisitionStats },
          documentFailures,
          checkpoint: checkpointed ? { ...checkpointed.checkpointStats } : undefined,
          ingestion: compactIngestion(ingestion),
        },
      };
    }
  } finally {
    await bridge.persist();
  }

  return result;
}
