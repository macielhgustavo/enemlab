#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createFetchAcquisitionTransport } from "../src/lib/discovery/acquisition";
import {
  FileContentAddressedDocumentStore,
  FileDocumentInventoryStore,
  FileExtractionCheckpointStore,
} from "../src/lib/discovery/node/fileStores";
import { UFPR_OFFICIAL_RECIPE } from "../src/lib/discovery/recipes/ufpr";
import {
  runSourcePipeline,
  type SourcePipelineDefinition,
} from "../src/lib/discovery/sourcePipeline";

interface CliOptions {
  source?: string;
  cacheDir: string;
  report?: string;
  concurrency: number;
  list: boolean;
  help: boolean;
}

const SOURCES: Record<string, SourcePipelineDefinition> = {
  // UFPR is intentionally acquisition-only until a trustworthy extractor is
  // registered. Adding `adapter` here automatically upgrades the runner to the
  // full IngestionEngine path without changing the CLI or cache layout.
  ufpr: { recipe: UFPR_OFFICIAL_RECIPE },
};

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    cacheDir: ".ingestion-cache/source-pipeline",
    concurrency: 4,
    list: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--list") {
      options.list = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} requires a value`);
    if (arg === "--source") options.source = value.toLowerCase();
    else if (arg === "--cache-dir") options.cacheDir = value;
    else if (arg === "--report") options.report = value;
    else if (arg === "--concurrency") {
      options.concurrency = parsePositiveInteger(value, "--concurrency");
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
    index += 1;
  }

  return options;
}

function usage(): string {
  return `ENEMLab source pipeline\n\nUsage:\n  npm run ingest:source -- --source ufpr\n  npm run ingest:source -- --list\n\nOptions:\n  --source <id>       source recipe to run\n  --cache-dir <path>  persistent cache root (default .ingestion-cache/source-pipeline)\n  --report <path>     write compact JSON report to this path\n  --concurrency <n>   acquisition/ingestion concurrency (default 4)\n  --list              list registered sources\n  --help              show this help\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (options.list) {
    for (const [id, definition] of Object.entries(SOURCES)) {
      process.stdout.write(
        `${id}\t${definition.recipe.institution}\t${definition.adapter ? "ingestion" : "acquisition-only"}\n`,
      );
    }
    return;
  }
  if (!options.source) throw new Error("--source is required (use --list to see sources)");

  const definition = SOURCES[options.source];
  if (!definition) {
    throw new Error(`unknown source ${options.source}; available: ${Object.keys(SOURCES).join(", ")}`);
  }

  const cacheRoot = resolve(options.cacheDir);
  const sourceRoot = join(cacheRoot, "sources", definition.recipe.sourceId);
  const reportPath = resolve(options.report ?? join(sourceRoot, "last-run.json"));
  const inventoryStore = new FileDocumentInventoryStore(join(sourceRoot, "inventory.json"));
  const blobStore = new FileContentAddressedDocumentStore(join(cacheRoot, "blobs"));
  const checkpointStore = new FileExtractionCheckpointStore(join(sourceRoot, "checkpoints"));
  const transport = createFetchAcquisitionTransport();

  const result = await runSourcePipeline(definition, {
    inventoryStore,
    blobStore,
    checkpointStore,
    transport,
    concurrency: options.concurrency,
  });

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");

  const summary = {
    source: options.source,
    sourceId: result.report.sourceId,
    mode: result.report.mode,
    cacheState: result.report.cacheState,
    editions: result.report.discovery.editionsDiscovered,
    logicalDocuments: result.report.discovery.logicalDocumentsDiscovered,
    uniqueDocumentUrls: result.report.discovery.uniqueDocumentUrls,
    networkRequests: result.report.acquisition.networkRequests,
    conditionalRequests: result.report.acquisition.conditionalRequests,
    notModified: result.report.acquisition.notModified,
    downloadedDocuments: result.report.acquisition.downloadedDocuments,
    downloadedBytes: result.report.acquisition.downloadedBytes,
    changedDocuments: result.report.acquisition.changedDocuments,
    checkpointHits: result.report.checkpoint?.hits ?? 0,
    checkpointMisses: result.report.checkpoint?.misses ?? 0,
    documentFailures: result.report.documentFailures.length,
    report: reportPath,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (result.report.documentFailures.length > 0) process.exitCode = 2;
  if (result.report.discovery.editionsDiscovered === 0) process.exitCode = 3;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
