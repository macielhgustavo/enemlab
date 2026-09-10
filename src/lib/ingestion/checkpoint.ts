import type {
  ExtractedAlternative,
  ExtractedExamData,
  ExtractedQuestion,
  IngestionAdapter,
  IngestionExtractionContext,
} from "./types";

export interface ExtractionCheckpointRecord {
  key: string;
  providerId: string;
  sourceId: string;
  editionId: string;
  importerVersion: string;
  documentShas: Record<string, string>;
  extraction: ExtractedExamData;
  createdAt: string;
}

/** Persistent implementations may live in IndexedDB, a DB or object storage. */
export interface ExtractionCheckpointStore {
  get(key: string): Promise<ExtractionCheckpointRecord | null>;
  set(record: ExtractionCheckpointRecord): Promise<void>;
}

export interface ExtractionCheckpointStats {
  hits: number;
  misses: number;
  writes: number;
  readErrors: number;
  writeErrors: number;
}

export interface CheckpointedIngestionAdapter extends IngestionAdapter {
  readonly checkpointStats: ExtractionCheckpointStats;
}

function cloneAlternative(alternative: ExtractedAlternative): ExtractedAlternative {
  return { ...alternative };
}

function cloneQuestion(question: ExtractedQuestion): ExtractedQuestion {
  return {
    ...question,
    alternatives: question.alternatives?.map(cloneAlternative),
    files: question.files ? [...question.files] : undefined,
  };
}

export function cloneExtractedExamData(data: ExtractedExamData): ExtractedExamData {
  return {
    ...data,
    questions: data.questions.map(cloneQuestion),
    answerKey: { ...data.answerKey },
    annulled: data.annulled ? [...data.annulled] : undefined,
    subjects: data.subjects ? { ...data.subjects } : undefined,
    questionsMissingMedia: data.questionsMissingMedia
      ? [...data.questionsMissingMedia]
      : undefined,
    semanticFidelityIssues: data.semanticFidelityIssues
      ? data.semanticFidelityIssues.map((issue) => ({ ...issue }))
      : undefined,
    warnings: data.warnings ? [...data.warnings] : undefined,
  };
}

function identityPart(value: string | undefined): string {
  return encodeURIComponent(value ?? "");
}

/**
 * Cache identity is deliberately content-addressed.
 *
 * URL alone is never sufficient because official institutions may silently
 * replace a PDF at the same address. Importer version is also part of the key,
 * so a parser fix cannot accidentally reuse output produced by old code.
 */
export function buildExtractionCheckpointKey(
  adapter: Pick<IngestionAdapter, "providerId" | "sourceId" | "importerVersion">,
  context: IngestionExtractionContext,
): string {
  const documents = [...context.documents]
    .map(({ fingerprint }) => `${identityPart(fingerprint.url)}@${fingerprint.sha256.toLowerCase()}`)
    .sort()
    .join("|");

  return [
    "enemlab-extraction-checkpoint-v1",
    identityPart(adapter.providerId),
    identityPart(adapter.sourceId),
    identityPart(context.plan.editionId),
    identityPart(context.plan.phase),
    identityPart(context.plan.variant),
    identityPart(adapter.importerVersion),
    documents,
  ].join(":");
}

function expectedDocumentShas(context: IngestionExtractionContext): Record<string, string> {
  return Object.fromEntries(
    context.documents
      .map(({ fingerprint }) => [fingerprint.url, fingerprint.sha256.toLowerCase()] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function checkpointMatches(
  record: ExtractionCheckpointRecord,
  adapter: IngestionAdapter,
  context: IngestionExtractionContext,
  key: string,
): boolean {
  if (
    record.key !== key ||
    record.providerId !== adapter.providerId ||
    record.sourceId !== adapter.sourceId ||
    record.editionId !== context.plan.editionId ||
    record.importerVersion !== adapter.importerVersion
  ) {
    return false;
  }

  const expected = expectedDocumentShas(context);
  const actual = record.documentShas;
  const urls = Object.keys(expected);
  return (
    urls.length === Object.keys(actual).length &&
    urls.every((url) => expected[url] === actual[url]?.toLowerCase())
  );
}

/** Simple deterministic store for tests, CLIs and process-local batch jobs. */
export class InMemoryExtractionCheckpointStore implements ExtractionCheckpointStore {
  private readonly records = new Map<string, ExtractionCheckpointRecord>();

  async get(key: string): Promise<ExtractionCheckpointRecord | null> {
    const record = this.records.get(key);
    return record
      ? {
          ...record,
          documentShas: { ...record.documentShas },
          extraction: cloneExtractedExamData(record.extraction),
        }
      : null;
  }

  async set(record: ExtractionCheckpointRecord): Promise<void> {
    this.records.set(record.key, {
      ...record,
      documentShas: { ...record.documentShas },
      extraction: cloneExtractedExamData(record.extraction),
    });
  }
}

/**
 * Adds a fail-safe extraction cache without changing the engine trust model.
 *
 * Cache failures are performance failures, not ingestion failures: a read error
 * falls back to the real extractor, and a write error only means the next run
 * will repeat work. Cached payloads still pass through all normal engine
 * structural, answer-key, media and semantic-fidelity validators.
 */
export function withExtractionCheckpointCache(
  adapter: IngestionAdapter,
  store: ExtractionCheckpointStore,
  now: () => Date = () => new Date(),
): CheckpointedIngestionAdapter {
  const stats: ExtractionCheckpointStats = {
    hits: 0,
    misses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
  };

  return {
    ...adapter,
    checkpointStats: stats,
    async extract(context) {
      const key = buildExtractionCheckpointKey(adapter, context);
      try {
        const cached = await store.get(key);
        if (cached && checkpointMatches(cached, adapter, context, key)) {
          stats.hits += 1;
          return cloneExtractedExamData(cached.extraction);
        }
      } catch {
        stats.readErrors += 1;
      }

      stats.misses += 1;
      const extraction = await adapter.extract(context);

      const record: ExtractionCheckpointRecord = {
        key,
        providerId: adapter.providerId,
        sourceId: adapter.sourceId,
        editionId: context.plan.editionId,
        importerVersion: adapter.importerVersion,
        documentShas: expectedDocumentShas(context),
        extraction: cloneExtractedExamData(extraction),
        createdAt: now().toISOString(),
      };

      try {
        await store.set(record);
        stats.writes += 1;
      } catch {
        stats.writeErrors += 1;
      }

      return cloneExtractedExamData(extraction);
    },
  };
}
