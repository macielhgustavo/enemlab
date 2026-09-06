// Revisão espaçada (portada do v6).
import { SRS_INTERVALS } from "./constants";
import { resolveProviderId } from "../providers/registry";
import type { Attempt, DB, ResultRow, SrsEntry } from "./types";

// Atualiza a fila SRS a partir de uma linha corrigida (muta db.srs).
export function updateSRS(db: DB, row: ResultRow, a: Attempt): void {
  if (!row.correct) return;
  const k = row.key;
  const existing = db.srs[k];
  // Acerto na primeira exposição não entra na fila.
  if (row.isCorrect && !existing) return;
  const old: SrsEntry = existing || {
    reps: 0,
    interval: 0,
    due: new Date().toISOString(),
    year: a.year,
    index: row.index,
    area: row.area,
    content: row.content,
    language: row.language,
    discipline: row.area,
  };
  if (row.isCorrect) {
    old.reps = (old.reps || 0) + 1;
    old.interval = SRS_INTERVALS[Math.min(old.reps, 5)];
    old.due = new Date(Date.now() + old.interval * 86400000).toISOString();
  } else {
    old.reps = 0;
    old.interval = 0;
    old.due = new Date(Date.now() + 6 * 3600000).toISOString();
  }
  old.lastResult = row.isCorrect ? "correct" : "wrong";
  old.providerId = resolveProviderId(a.providerId);
  old.year = a.year;
  old.index = row.index;
  old.area = row.area;
  old.content = row.content;
  old.language = row.language;
  db.srs[k] = old;
}

export interface DueSrs extends SrsEntry {
  key: string;
}
export function dueSRS(db: DB): DueSrs[] {
  return Object.entries(db.srs)
    .filter(([, v]) => new Date(v.due).getTime() <= Date.now())
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => +new Date(a.due) - +new Date(b.due));
}

export function allSrs(db: DB): DueSrs[] {
  return Object.entries(db.srs)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => +new Date(a.due) - +new Date(b.due));
}
