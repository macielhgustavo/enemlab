import type { DocumentFetcher, FetchedDocument } from "../sources/ingestion";
import { fingerprintFetchedDocument } from "../ingestion/fingerprint";
import {
  DocumentInventory,
  type DocumentInventoryRecord,
  type DocumentInventoryStore,
} from "./documentInventory";

const ACQUISITION_FINGERPRINT_VERSION = "acquisition@1";

export interface AcquisitionRequest {
  url: string;
  headers: Record<string, string>;
}

export interface AcquisitionResponse {
  /** Final response URL after redirects. */
  url: string;
  status: number;
  headers: Record<string, string>;
  /** Omitted for bodyless responses such as HTTP 304. */
  bytes?: Uint8Array;
}

export interface AcquisitionTransport {
  (request: AcquisitionRequest): Promise<AcquisitionResponse>;
}

export interface StoredDocumentBlob {
  sha256: string;
  bytes: Uint8Array;
  storedAt?: string;
}

/**
 * Physical document storage is addressed only by SHA-256, never URL.
 * Different official URLs that serve identical bytes therefore share one blob.
 */
export interface ContentAddressedDocumentStore {
  get(sha256: string): Promise<StoredDocumentBlob | null>;
  put(blob: StoredDocumentBlob): Promise<void>;
}

export interface AcquisitionStats {
  logicalRequests: number;
  coalescedRequests: number;
  networkRequests: number;
  conditionalRequests: number;
  notModified: number;
  downloadedDocuments: number;
  downloadedBytes: number;
  newDocuments: number;
  changedDocuments: number;
  unchangedDownloads: number;
  blobReads: number;
  blobHits: number;
  blobMisses: number;
  blobWrites: number;
  failures: number;
}

export interface InventoryBackedDocumentFetcher extends DocumentFetcher {
  readonly stats: AcquisitionStats;
}

export interface AcquisitionFetcherOptions {
  sourceId: string;
  inventory: DocumentInventory;
  blobStore: ContentAddressedDocumentStore;
  transport: AcquisitionTransport;
  /** Redirect targets must remain under one of these official hosts. */
  allowedHosts: readonly string[];
  /** Defensive post-download body limit. Defaults to 64 MiB. */
  maxBytes?: number;
  now?: () => Date;
}

export interface AcquisitionSession {
  inventory: DocumentInventory;
  fetcher: InventoryBackedDocumentFetcher;
  readonly stats: AcquisitionStats;
  persist(): Promise<void>;
}

export interface OpenAcquisitionSessionOptions
  extends Omit<AcquisitionFetcherOptions, "inventory"> {
  inventoryStore: DocumentInventoryStore;
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

function cloneFetched(document: FetchedDocument): FetchedDocument {
  return {
    url: document.url,
    bytes: new Uint8Array(document.bytes),
    headers: { ...document.headers },
  };
}

function consensus(
  records: readonly DocumentInventoryRecord[],
  field: "sha256" | "etag" | "lastModified" | "contentLength",
): string | number | undefined {
  const values = new Set(
    records
      .map((record) => record[field])
      .filter((value): value is string | number => value !== undefined),
  );
  if (values.size > 1) {
    throw new Error(`inventory metadata conflict for ${field}`);
  }
  return [...values][0];
}

function newStats(): AcquisitionStats {
  return {
    logicalRequests: 0,
    coalescedRequests: 0,
    networkRequests: 0,
    conditionalRequests: 0,
    notModified: 0,
    downloadedDocuments: 0,
    downloadedBytes: 0,
    newDocuments: 0,
    changedDocuments: 0,
    unchangedDownloads: 0,
    blobReads: 0,
    blobHits: 0,
    blobMisses: 0,
    blobWrites: 0,
    failures: 0,
  };
}

async function readBlob(
  store: ContentAddressedDocumentStore,
  sha256: string,
  stats: AcquisitionStats,
): Promise<StoredDocumentBlob | null> {
  stats.blobReads += 1;
  const blob = await store.get(sha256.toLowerCase());
  if (blob) {
    if (blob.sha256.toLowerCase() !== sha256.toLowerCase()) {
      throw new Error(`blob store returned mismatched SHA for ${sha256}`);
    }
    stats.blobHits += 1;
    return { ...blob, sha256: blob.sha256.toLowerCase(), bytes: new Uint8Array(blob.bytes) };
  }
  stats.blobMisses += 1;
  return null;
}

/**
 * Adapts the platform Fetch API to the richer acquisition transport contract.
 * Tests and CLIs may inject a transport instead, so discovery/acquisition stays
 * deterministic and network-free under unit tests.
 */
export function createFetchAcquisitionTransport(
  fetchImpl: typeof fetch = globalThis.fetch,
): AcquisitionTransport {
  return async ({ url, headers }) => {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      redirect: "follow",
    });
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    return {
      url: response.url || url,
      status: response.status,
      headers: responseHeaders,
      bytes:
        response.status === 304
          ? undefined
          : new Uint8Array(await response.arrayBuffer()),
    };
  };
}

/** Simple process-local content-addressed store for tests and small CLIs. */
export class InMemoryContentAddressedDocumentStore
  implements ContentAddressedDocumentStore
{
  private readonly blobs = new Map<string, StoredDocumentBlob>();

  async get(sha256: string): Promise<StoredDocumentBlob | null> {
    const blob = this.blobs.get(sha256.toLowerCase());
    return blob
      ? { ...blob, bytes: new Uint8Array(blob.bytes) }
      : null;
  }

  async put(blob: StoredDocumentBlob): Promise<void> {
    const sha256 = blob.sha256.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error("content-addressed blob requires a SHA-256 hex key");
    }
    this.blobs.set(sha256, {
      ...blob,
      sha256,
      bytes: new Uint8Array(blob.bytes),
    });
  }
}

/**
 * Builds the DocumentFetcher consumed by IngestionEngine on top of a persistent
 * document inventory and SHA-addressed byte store.
 *
 * Freshness policy:
 * - if cached bytes + ETag/Last-Modified exist, send a conditional GET;
 * - HTTP 304 reuses cached bytes and never downloads the PDF body;
 * - if validators are absent, download and compare SHA (fail-safe path);
 * - if metadata exists but its blob is missing, do a full GET rather than risk
 *   receiving a useless 304;
 * - duplicate logical requests for one URL in the same run are coalesced.
 */
export function createInventoryBackedDocumentFetcher(
  options: AcquisitionFetcherOptions,
): InventoryBackedDocumentFetcher {
  const {
    sourceId,
    inventory,
    blobStore,
    transport,
    allowedHosts,
    maxBytes = 64 * 1024 * 1024,
    now = () => new Date(),
  } = options;

  if (!sourceId.trim()) throw new Error("acquisition requires sourceId");
  if (!allowedHosts.length) throw new Error("acquisition requires allowedHosts");
  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    throw new Error("acquisition maxBytes must be positive");
  }

  const stats = newStats();
  const inRun = new Map<string, Promise<FetchedDocument>>();

  const acquire = async (url: string): Promise<FetchedDocument> => {
    if (!hostAllowed(url, allowedHosts)) {
      throw new Error(`acquisition URL is outside source allowlist: ${url}`);
    }

    const records = inventory.findByUrl(sourceId, url);
    if (!records.length) {
      throw new Error(`cannot acquire document before discovery inventory: ${url}`);
    }

    const previousSha = consensus(records, "sha256") as string | undefined;
    const previousEtag = consensus(records, "etag") as string | undefined;
    const previousLastModified = consensus(records, "lastModified") as string | undefined;

    let cachedBlob: StoredDocumentBlob | null = null;
    if (previousSha) {
      cachedBlob = await readBlob(blobStore, previousSha, stats);
    }

    const requestHeaders: Record<string, string> = {};
    if (cachedBlob && previousEtag) requestHeaders["if-none-match"] = previousEtag;
    if (cachedBlob && previousLastModified) {
      requestHeaders["if-modified-since"] = previousLastModified;
    }
    const conditional = Object.keys(requestHeaders).length > 0;
    if (conditional) stats.conditionalRequests += 1;

    let response: AcquisitionResponse;
    try {
      stats.networkRequests += 1;
      response = await transport({ url, headers: requestHeaders });
    } catch (error) {
      stats.failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      inventory.recordFetchFailure(sourceId, url, message, now().toISOString());
      throw error;
    }

    if (!hostAllowed(response.url, allowedHosts)) {
      const message = `acquisition redirected outside source allowlist: ${response.url}`;
      stats.failures += 1;
      inventory.recordFetchFailure(sourceId, url, message, now().toISOString());
      throw new Error(message);
    }

    const headers = normalizeHeaders(response.headers);
    const importedAt = now().toISOString();

    if (response.status === 304) {
      if (!conditional || !previousSha || !cachedBlob) {
        const message = "received HTTP 304 without a usable cached blob";
        stats.failures += 1;
        inventory.recordFetchFailure(sourceId, url, message, importedAt);
        throw new Error(message);
      }

      stats.notModified += 1;
      const mergedHeaders: Record<string, string> = {
        ...(previousEtag ? { etag: previousEtag } : {}),
        ...(previousLastModified ? { "last-modified": previousLastModified } : {}),
        ...headers,
      };
      inventory.recordFingerprint(sourceId, {
        url,
        contentLength: cachedBlob.bytes.byteLength,
        sha256: previousSha.toLowerCase(),
        etag: mergedHeaders.etag,
        lastModified: mergedHeaders["last-modified"],
        parserVersion: ACQUISITION_FINGERPRINT_VERSION,
        importedAt,
      });
      return {
        url,
        bytes: new Uint8Array(cachedBlob.bytes),
        headers: mergedHeaders,
      };
    }

    if (response.status < 200 || response.status >= 300) {
      const message = `acquisition returned HTTP ${response.status}`;
      stats.failures += 1;
      inventory.recordFetchFailure(sourceId, url, message, importedAt);
      throw new Error(`${url}: ${message}`);
    }
    if (!response.bytes) {
      const message = "successful acquisition response had no body";
      stats.failures += 1;
      inventory.recordFetchFailure(sourceId, url, message, importedAt);
      throw new Error(`${url}: ${message}`);
    }
    if (response.bytes.byteLength > maxBytes) {
      const message = `document exceeds acquisition maxBytes (${response.bytes.byteLength} > ${maxBytes})`;
      stats.failures += 1;
      inventory.recordFetchFailure(sourceId, url, message, importedAt);
      throw new Error(`${url}: ${message}`);
    }

    stats.downloadedDocuments += 1;
    stats.downloadedBytes += response.bytes.byteLength;

    const fetched: FetchedDocument = {
      // Keep the discovered canonical URL as provenance identity while still
      // validating the final redirect target above.
      url,
      bytes: new Uint8Array(response.bytes),
      headers,
    };
    const fingerprint = await fingerprintFetchedDocument(
      fetched,
      ACQUISITION_FINGERPRINT_VERSION,
      importedAt,
    );

    if (!previousSha) stats.newDocuments += 1;
    else if (previousSha.toLowerCase() === fingerprint.sha256) {
      stats.unchangedDownloads += 1;
    } else {
      stats.changedDocuments += 1;
    }

    let existingBlob: StoredDocumentBlob | null = null;
    if (cachedBlob && previousSha?.toLowerCase() === fingerprint.sha256) {
      existingBlob = cachedBlob;
    } else {
      existingBlob = await readBlob(blobStore, fingerprint.sha256, stats);
    }
    if (!existingBlob) {
      await blobStore.put({
        sha256: fingerprint.sha256,
        bytes: fetched.bytes,
        storedAt: importedAt,
      });
      stats.blobWrites += 1;
    }

    inventory.recordFingerprint(sourceId, fingerprint);
    return fetched;
  };

  const fetcher = (async (url: string) => {
    stats.logicalRequests += 1;
    const existing = inRun.get(url);
    if (existing) {
      stats.coalescedRequests += 1;
      return cloneFetched(await existing);
    }

    const pending = acquire(url);
    inRun.set(url, pending);
    try {
      return cloneFetched(await pending);
    } catch (error) {
      // A transient failure may be retried by a later logical request.
      inRun.delete(url);
      throw error;
    }
  }) as InventoryBackedDocumentFetcher;
  Object.defineProperty(fetcher, "stats", { value: stats, enumerable: true });
  return fetcher;
}

/**
 * Opens one acquisition run from the durable inventory. Persist after the
 * ingestion run so fresh validators/SHA metadata survive the next process.
 */
export async function openAcquisitionSession(
  options: OpenAcquisitionSessionOptions,
): Promise<AcquisitionSession> {
  const inventory = new DocumentInventory(await options.inventoryStore.load());
  const fetcher = createInventoryBackedDocumentFetcher({
    sourceId: options.sourceId,
    inventory,
    blobStore: options.blobStore,
    transport: options.transport,
    allowedHosts: options.allowedHosts,
    maxBytes: options.maxBytes,
    now: options.now,
  });

  return {
    inventory,
    fetcher,
    stats: fetcher.stats,
    async persist() {
      await options.inventoryStore.save(inventory.snapshot());
    },
  };
}
