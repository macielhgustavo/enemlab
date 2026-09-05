import type { Attempt, DB, Note, SrsEntry } from "../domain/types";

function clone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function asTime(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function attemptScore(attempt: Attempt): [number, number, number, number] {
  return [
    attempt.finishedAt ? 1 : 0,
    attempt.result?.rows?.length || 0,
    Object.keys(attempt.answers || {}).length,
    Math.max(asTime(attempt.finishedAt), asTime(attempt.startedAt)),
  ];
}

function preferAttempt(local: Attempt, cloud: Attempt): Attempt {
  const a = attemptScore(local);
  const b = attemptScore(cloud);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return clone(a[i] > b[i] ? local : cloud);
  }
  return clone(local);
}

function mergeNotes(cloud: Note | undefined, local: Note | undefined): Note {
  if (!cloud) return clone(local || {});
  if (!local) return clone(cloud);

  const out: Note = { ...cloud, ...local };
  const cloudText = cloud.text?.trim();
  const localText = local.text?.trim();
  if (cloudText && localText && cloudText !== localText) {
    out.text = `${cloudText}\n\n—\n\n${localText}`;
  }
  return out;
}

function preferSrs(local: SrsEntry, cloud: SrsEntry): SrsEntry {
  const localScore = [local.reps || 0, local.interval || 0, asTime(local.due)];
  const cloudScore = [cloud.reps || 0, cloud.interval || 0, asTime(cloud.due)];
  for (let i = 0; i < localScore.length; i++) {
    if (localScore[i] !== cloudScore[i]) return clone(localScore[i] > cloudScore[i] ? local : cloud);
  }
  return clone(local);
}

function latestDate(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b || null;
  if (!b) return a;
  return asTime(a) >= asTime(b) ? a : b;
}

/**
 * Mescla dois snapshots sem apagar silenciosamente histórico de estudo.
 * O dispositivo atual vence apenas em preferências simples (tema/metas);
 * coleções históricas são unidas e registros equivalentes preservam a versão
 * com mais progresso.
 */
export function mergeCloudDB(local: DB, cloud: Partial<DB> | null | undefined): DB {
  if (!cloud) return clone(local);

  const cloudAttempts = Array.isArray(cloud.attempts) ? cloud.attempts : [];
  const localAttempts = Array.isArray(local.attempts) ? local.attempts : [];
  const attempts = new Map<string, Attempt>();

  cloudAttempts.forEach((attempt) => attempts.set(attempt.id, clone(attempt)));
  localAttempts.forEach((attempt) => {
    const existing = attempts.get(attempt.id);
    attempts.set(attempt.id, existing ? preferAttempt(attempt, existing) : clone(attempt));
  });

  const noteKeys = new Set([
    ...Object.keys(cloud.notes || {}),
    ...Object.keys(local.notes || {}),
  ]);
  const notes: DB["notes"] = {};
  noteKeys.forEach((key) => {
    notes[key] = mergeNotes(cloud.notes?.[key], local.notes?.[key]);
  });

  const srsKeys = new Set([
    ...Object.keys(cloud.srs || {}),
    ...Object.keys(local.srs || {}),
  ]);
  const srs: DB["srs"] = {};
  srsKeys.forEach((key) => {
    const l = local.srs?.[key];
    const c = cloud.srs?.[key];
    if (l && c) srs[key] = preferSrs(l, c);
    else if (l) srs[key] = clone(l);
    else if (c) srs[key] = clone(c);
  });

  const mergedAttempts = [...attempts.values()].sort(
    (a, b) => Math.max(asTime(b.finishedAt), asTime(b.startedAt)) - Math.max(asTime(a.finishedAt), asTime(a.startedAt)),
  );

  return {
    ...clone(cloud as DB),
    ...clone(local),
    v: 6,
    attempts: mergedAttempts,
    notes,
    srs,
    // Sessões são derivadas das tentativas e serão reconstruídas pelo chamador.
    sessions: [],
    goals: clone(local.goals || cloud.goals || { questions: 150, essays: 2, reviews: 30 }),
    theme: local.theme || cloud.theme || "dark",
    lastOpened: local.lastOpened || cloud.lastOpened || null,
    lastBackupAt: latestDate(local.lastBackupAt, cloud.lastBackupAt),
  };
}
