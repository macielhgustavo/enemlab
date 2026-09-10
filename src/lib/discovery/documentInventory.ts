import type { DiscoveredDocument, DiscoveredEdition, DocumentFingerprint } from "../sources/ingestion";

export interface DocumentInventoryRecord {
  key: string;
  sourceId: string;
  institution: string;
  editionId: string;
  year: number;
  role: DiscoveredDocument["role"];
  url: string;
  phase?: string;
  subject?: string;
  variant?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sightings: number;
  fetchedAt?: string;
  fetchCount: number;
  contentLength?: number;
  sha256?: string;
  lastModified?: string;
  etag?: string;
  lastFetchError?: string;
}

export interface DocumentInventorySnapshot {
  version: 1;
  records: DocumentInventoryRecord[];
}

export interface DocumentInventoryStore {
  load(): Promise<DocumentInventorySnapshot | null>;
  save(snapshot: DocumentInventorySnapshot): Promise<void>;
}

function identityPart(value: string | undefined): string {
  return encodeURIComponent(value ?? "");
}

export function buildDocumentInventoryKey(
  sourceId: string,
  edition: Pick<DiscoveredEdition, "editionId">,
  document: DiscoveredDocument,
): string {
  return [
    "enemlab-document-v1",
    identityPart(sourceId),
    identityPart(edition.editionId),
    identityPart(document.role),
    identityPart(document.phase),
    identityPart(document.variant),
    identityPart(document.subject),
    identityPart(document.url),
  ].join(":");
}

function cloneRecord(record: DocumentInventoryRecord): DocumentInventoryRecord {
  return { ...record };
}

function validateSnapshot(snapshot: DocumentInventorySnapshot): void {
  if (snapshot.version !== 1 || !Array.isArray(snapshot.records)) {
    throw new Error("unsupported document inventory snapshot");
  }

  const keys = new Set<string>();
  for (const record of snapshot.records) {
    if (!record.key || keys.has(record.key)) {
      throw new Error("document inventory contains duplicate or empty keys");
    }
    if (!Number.isInteger(record.year) || record.year < 1900) {
      throw new Error(`document inventory contains invalid year ${record.year}`);
    }
    if (!/^https?:\/\//i.test(record.url)) {
      throw new Error(`document inventory contains invalid URL ${record.url}`);
    }
    if (record.sightings < 1 || record.fetchCount < 0) {
      throw new Error("document inventory contains invalid counters");
    }
    keys.add(record.key);
  }
}

/**
 * Content-addressable inventory metadata for documents discovered before extraction.
 *
 * The inventory is deliberately independent from the extraction checkpoint cache:
 * discovery should not need to rediscover a URL just because an extractor changed.
 * Callers may persist `snapshot()` as JSON, IndexedDB, SQLite or object storage.
 */
export class DocumentInventory {
  private readonly records = new Map<string, DocumentInventoryRecord>();

  constructor(snapshot?: DocumentInventorySnapshot | null) {
    if (!snapshot) return;
    validateSnapshot(snapshot);
    for (const record of snapshot.records) this.records.set(record.key, cloneRecord(record));
  }

  observeEdition(
    sourceId: string,
    institution: string,
    edition: DiscoveredEdition,
    seenAt: string,
  ): void {
    for (const document of edition.documents) {
      const key = buildDocumentInventoryKey(sourceId, edition, document);
      const previous = this.records.get(key);
      if (previous) {
        previous.lastSeenAt = seenAt;
        previous.sightings += 1;
        continue;
      }

      this.records.set(key, {
        key,
        sourceId,
        institution,
        editionId: edition.editionId,
        year: edition.year,
        role: document.role,
        url: document.url,
        phase: document.phase,
        subject: document.subject,
        variant: document.variant,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        sightings: 1,
        fetchCount: 0,
      });
    }
  }

  recordFingerprint(sourceId: string, fingerprint: DocumentFingerprint): void {
    let matched = false;
    for (const record of this.records.values()) {
      if (record.sourceId !== sourceId || record.url !== fingerprint.url) continue;
      record.fetchedAt = fingerprint.importedAt;
      record.fetchCount += 1;
      record.contentLength = fingerprint.contentLength;
      record.sha256 = fingerprint.sha256.toLowerCase();
      record.lastModified = fingerprint.lastModified;
      record.etag = fingerprint.etag;
      record.lastFetchError = undefined;
      matched = true;
    }
    if (!matched) {
      throw new Error(`cannot fingerprint undiscovered document ${fingerprint.url}`);
    }
  }

  recordFetchFailure(sourceId: string, url: string, message: string, attemptedAt: string): void {
    let matched = false;
    for (const record of this.records.values()) {
      if (record.sourceId !== sourceId || record.url !== url) continue;
      record.fetchedAt = attemptedAt;
      record.fetchCount += 1;
      record.lastFetchError = message;
      matched = true;
    }
    if (!matched) throw new Error(`cannot fail undiscovered document ${url}`);
  }

  get(key: string): DocumentInventoryRecord | null {
    const record = this.records.get(key);
    return record ? cloneRecord(record) : null;
  }

  findByUrl(sourceId: string, url: string): DocumentInventoryRecord[] {
    return [...this.records.values()]
      .filter((record) => record.sourceId === sourceId && record.url === url)
      .map(cloneRecord);
  }

  snapshot(): DocumentInventorySnapshot {
    return {
      version: 1,
      records: [...this.records.values()]
        .map(cloneRecord)
        .sort((left, right) => left.key.localeCompare(right.key)),
    };
  }
}

/** Simple store for tests and process-local jobs. */
export class InMemoryDocumentInventoryStore implements DocumentInventoryStore {
  private value: DocumentInventorySnapshot | null = null;

  constructor(snapshot?: DocumentInventorySnapshot | null) {
    this.value = snapshot
      ? { version: 1, records: snapshot.records.map(cloneRecord) }
      : null;
  }

  async load(): Promise<DocumentInventorySnapshot | null> {
    return this.value
      ? { version: 1, records: this.value.records.map(cloneRecord) }
      : null;
  }

  async save(snapshot: DocumentInventorySnapshot): Promise<void> {
    validateSnapshot(snapshot);
    this.value = { version: 1, records: snapshot.records.map(cloneRecord) };
  }
}

/**
 * Storage adapter for callers that already know how to read/write a JSON blob.
 * Keeps Node `fs` and browser storage concerns out of the shared discovery code.
 */
export class JsonDocumentInventoryStore implements DocumentInventoryStore {
  constructor(
    private readonly readText: () => Promise<string | null>,
    private readonly writeText: (value: string) => Promise<void>,
  ) {}

  async load(): Promise<DocumentInventorySnapshot | null> {
    const raw = await this.readText();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DocumentInventorySnapshot;
    validateSnapshot(parsed);
    return { version: 1, records: parsed.records.map(cloneRecord) };
  }

  async save(snapshot: DocumentInventorySnapshot): Promise<void> {
    validateSnapshot(snapshot);
    await this.writeText(`${JSON.stringify(snapshot, null, 2)}\n`);
  }
}
