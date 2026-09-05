// Camada leve de IndexedDB para snapshots do estado (segurança de dados).
import type { DB } from "./domain/types";

const DB_NAME = "enem_lab_next_cache";
const DB_VERSION = 1;
const STORE = "snapshots";
const MAX_SNAPSHOTS = 5;

export interface Snapshot {
  id: string;
  createdAt: string;
  reason: string;
  data: DB;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function listSnapshots(): Promise<Snapshot[]> {
  try {
    const d = await open();
    const all = await new Promise<Snapshot[]>((res, rej) => {
      const tx = d.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).getAll();
      r.onsuccess = () => res((r.result as Snapshot[]) || []);
      r.onerror = () => rej(r.error);
    });
    return all.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  } catch {
    return [];
  }
}

export async function saveSnapshot(db: DB, reason = "manual"): Promise<void> {
  try {
    const d = await open();
    const snap: Snapshot = {
      id: `${Date.now()}_${reason}`,
      createdAt: new Date().toISOString(),
      reason,
      data: JSON.parse(JSON.stringify(db)),
    };
    await new Promise<void>((res, rej) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(snap);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    // Poda para manter apenas os últimos MAX_SNAPSHOTS.
    const all = await listSnapshots();
    if (all.length > MAX_SNAPSHOTS) {
      const d2 = await open();
      for (const x of all.slice(MAX_SNAPSHOTS)) {
        await new Promise<void>((res) => {
          const tx = d2.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(x.id);
          tx.oncomplete = () => res();
          tx.onerror = () => res();
        });
      }
    }
  } catch {
    /* IndexedDB indisponível — ignora */
  }
}

export async function getSnapshot(id: string): Promise<Snapshot | undefined> {
  try {
    const d = await open();
    return await new Promise<Snapshot | undefined>((res, rej) => {
      const tx = d.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(id);
      r.onsuccess = () => res(r.result as Snapshot | undefined);
      r.onerror = () => rej(r.error);
    });
  } catch {
    return undefined;
  }
}
