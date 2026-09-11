import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ContentAddressedDocumentStore,
  StoredDocumentBlob,
} from "../acquisition";
import type {
  DocumentInventorySnapshot,
  DocumentInventoryStore,
} from "../documentInventory";
import type {
  ExtractionCheckpointRecord,
  ExtractionCheckpointStore,
} from "../../ingestion/checkpoint";

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readIfPresent(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(path: string, value: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await writeFile(temporary, value);
  await rename(temporary, path);
}

/** Durable JSON inventory for process-to-process source runs. */
export class FileDocumentInventoryStore implements DocumentInventoryStore {
  constructor(private readonly path: string) {}

  async load(): Promise<DocumentInventorySnapshot | null> {
    const raw = await readIfPresent(this.path);
    if (!raw) return null;
    return JSON.parse(raw.toString("utf8")) as DocumentInventorySnapshot;
  }

  async save(snapshot: DocumentInventorySnapshot): Promise<void> {
    await atomicWrite(this.path, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
}

/**
 * Stores physical document bytes by SHA-256.
 *
 * The URL never appears in the blob path. Two sources serving identical bytes
 * therefore share one object, while an upstream replacement creates a new one
 * instead of overwriting historical evidence.
 */
export class FileContentAddressedDocumentStore
  implements ContentAddressedDocumentStore
{
  constructor(private readonly root: string) {}

  private pathFor(input: string): string {
    const digest = input.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error("content-addressed file store requires SHA-256 hex keys");
    }
    return join(this.root, "sha256", digest.slice(0, 2), `${digest}.bin`);
  }

  async get(input: string): Promise<StoredDocumentBlob | null> {
    const digest = input.toLowerCase();
    const raw = await readIfPresent(this.pathFor(digest));
    if (!raw) return null;
    const actual = sha256(raw);
    if (actual !== digest) {
      throw new Error(`content-addressed blob is corrupt: expected ${digest}, got ${actual}`);
    }
    return { sha256: digest, bytes: new Uint8Array(raw) };
  }

  async put(blob: StoredDocumentBlob): Promise<void> {
    const digest = blob.sha256.toLowerCase();
    const actual = sha256(blob.bytes);
    if (actual !== digest) {
      throw new Error(`refusing blob with mismatched SHA: expected ${digest}, got ${actual}`);
    }

    const path = this.pathFor(digest);
    const existing = await readIfPresent(path);
    if (existing) {
      const existingDigest = sha256(existing);
      if (existingDigest !== digest) {
        throw new Error(`existing content-addressed blob is corrupt: ${path}`);
      }
      return;
    }
    await atomicWrite(path, blob.bytes);
  }
}

/** Persistent extraction checkpoints keyed by a hash of the logical cache key. */
export class FileExtractionCheckpointStore implements ExtractionCheckpointStore {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    return join(this.root, `${sha256(key)}.json`);
  }

  async get(key: string): Promise<ExtractionCheckpointRecord | null> {
    const raw = await readIfPresent(this.pathFor(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw.toString("utf8")) as ExtractionCheckpointRecord;
    if (parsed.key !== key) {
      throw new Error("extraction checkpoint key/hash mismatch");
    }
    return parsed;
  }

  async set(record: ExtractionCheckpointRecord): Promise<void> {
    await atomicWrite(this.pathFor(record.key), `${JSON.stringify(record, null, 2)}\n`);
  }
}
