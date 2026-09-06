// Estatística e seletores derivados do estado (portados do v6).
// Funções puras: recebem o db como argumento.
import { pct } from "../format";
import { contentAllLabels } from "./constants";
import { classifyContent, discipline, isUnclassifiedContent, questionKey } from "./classify";
import { DEFAULT_PROVIDER_ID, filterByProvider, resolveProviderId } from "../providers/registry";
import type {
  Attempt,
  DB,
  Question,
  ResultRow,
  StudySession,
  Difficulty,
} from "./types";

export interface EnrichedRow extends ResultRow {
  attemptId: string;
  finishedAt: string | null;
}
export interface Tally {
  c: number;
  t: number;
}

export function getAttempt(db: DB, id: string | null): Attempt | undefined {
  return db.attempts.find((a) => a.id === id);
}

export function officialRows(db: DB): EnrichedRow[] {
  return db.attempts
    .filter((a) => a.result)
    .flatMap((a) =>
      a.result!.rows.map((r) => ({
        ...r,
        // Linhas gravadas antes da v8 não têm a prova: herdam a da tentativa,
        // que por sua vez resolve para ENEM quando também está ausente.
        providerId: resolveProviderId(r.providerId ?? a.providerId),
        attemptId: a.id,
        finishedAt: a.finishedAt,
      })),
    );
}

/**
 * Linhas de uma prova específica. É por aqui que as estatísticas de bancas
 * diferentes deixam de se misturar: quem quiser um número por prova filtra
 * antes de agregar.
 */
export function officialRowsOf(db: DB, providerId?: string | null): EnrichedRow[] {
  return filterByProvider(officialRows(db), providerId);
}

/** Provas que aparecem no histórico, já normalizando os dados antigos. */
export function providersInHistory(db: DB): string[] {
  return [...new Set(officialRows(db).map((r) => resolveProviderId(r.providerId)))].sort();
}

export function parseManualTags(note?: { tags?: string; tag?: string }): string[] {
  const raw = (note?.tags || note?.tag || "").trim();
  if (!raw) return [];
  return [...new Set(raw.split(/[;,]/).map((x) => x.trim()).filter(Boolean))].slice(0, 4);
}

export function questionTagsByRow(db: DB, row: EnrichedRow): string[] {
  const note = db.notes[`${row.attemptId}|${row.key}`] || {};
  const manual = parseManualTags(note);
  if (manual.length) return manual;
  if (row.tags?.length) return row.tags;
  return [row.content].filter(Boolean);
}

export function areaStats(db: DB): Record<string, Tally> {
  const out: Record<string, Tally> = {};
  officialRows(db)
    .filter((x) => x.correct)
    .forEach((x) => {
      (out[x.area] ??= { c: 0, t: 0 }).t++;
      if (x.isCorrect) out[x.area].c++;
    });
  return out;
}

export function rollingRows(db: DB, n = 100): EnrichedRow[] {
  return officialRows(db)
    .filter((x) => x.correct)
    .slice(-n);
}

export function streakDays(db: DB): number {
  const dates = [
    ...new Set(
      db.attempts
        .filter((a) => a.result)
        .map((a) => new Date(a.finishedAt!).toISOString().slice(0, 10)),
    ),
  ]
    .sort()
    .reverse();
  let streak = 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 100; i++) {
    const key = d.toISOString().slice(0, 10);
    if (dates.includes(key)) streak++;
    else if (i > 0) break;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ---- Wilson (IC 95%) ----
export interface Wilson {
  low: number;
  high: number;
  width: number;
}
export function wilsonInterval(c: number, n: number, z = 1.96): Wilson {
  if (!n) return { low: 0, high: 100, width: 100 };
  const p = c / n,
    zz = z * z,
    den = 1 + zz / n;
  const center = (p + zz / (2 * n)) / den;
  const margin = (z * Math.sqrt((p * (1 - p) + zz / (4 * n)) / n)) / den;
  const low = Math.max(0, (center - margin) * 100),
    high = Math.min(100, (center + margin) * 100);
  return { low: Math.round(low), high: Math.round(high), width: Math.round(high - low) };
}
export function statisticalConfidence(c: number, n: number): { label: string; cls: string } {
  if (!n) return { label: "sem amostra", cls: "confLow" };
  const w = wilsonInterval(c, n).width;
  if (n >= 20 && w <= 25) return { label: "alta", cls: "confHigh" };
  if (n >= 8 && w <= 42) return { label: "média", cls: "confMed" };
  return { label: "baixa", cls: "confLow" };
}

// ---- Mastery (multi-tag) ----
/**
 * Domínio por conteúdo. Escopado por prova de propósito: a taxonomia de
 * conteúdos é do ENEM, e deixar linhas de outra banca entrarem aqui somaria
 * desempenhos que não se comparam. O padrão é ENEM para preservar todo o
 * comportamento anterior.
 */
export function masteryStats(
  db: DB,
  providerId: string | null = DEFAULT_PROVIDER_ID,
): Record<string, Tally> {
  const out: Record<string, Tally> = {};
  for (const n of contentAllLabels()) out[n] = { c: 0, t: 0 };
  const base = providerId === null ? officialRows(db) : officialRowsOf(db, providerId);
  for (const row of base.filter((x) => x.correct)) {
    for (const tag of questionTagsByRow(db, row)) {
      (out[tag] ??= { c: 0, t: 0 }).t++;
      if (row.isCorrect) out[tag].c++;
    }
  }
  return out;
}

export interface WeakContent extends Tally {
  name: string;
  p: number;
}
export function weakestContents(db: DB, n = 5): WeakContent[] {
  const st = masteryStats(db);
  return Object.entries(st)
    .filter(([name, v]) => v.t > 0 && !isUnclassifiedContent(name))
    .map(([name, v]) => ({ name, ...v, p: pct(v.c, v.t) }))
    .sort((a, b) => a.p - b.p || b.t - a.t)
    .slice(0, n);
}

export function retentionForContent(db: DB, name: string): number {
  const ss = Object.values(db.srs).filter((x) => x.content === name);
  if (!ss.length) return 50;
  return pct(ss.filter((x) => x.lastResult === "correct").length, ss.length);
}

export interface MasteryState {
  label: string;
  cls: "mastered" | "stable" | "weak" | "untested";
  p: number | null;
  ci: Wilson;
  conf: { label: string; cls: string };
}
export function contentMasteryState(db: DB, name: string, v: Tally): MasteryState {
  const p = v.t ? pct(v.c, v.t) : null;
  const ret = retentionForContent(db, name);
  const ci = wilsonInterval(v.c, v.t);
  const conf = statisticalConfidence(v.c, v.t);
  if (v.t === 0) return { label: "não testado", cls: "untested", p: null, ci, conf };
  if (v.t < 4) return { label: "amostra insuficiente", cls: "untested", p, ci, conf };
  if (v.t < 10)
    return { label: p! >= 70 ? "promissor" : "instável", cls: p! >= 70 ? "stable" : "weak", p, ci, conf };
  if (p! >= 80 && ret >= 70 && ci.low >= 65) return { label: "dominado", cls: "mastered", p, ci, conf };
  if (p! >= 65) return { label: "estável", cls: "stable", p, ci, conf };
  return { label: "fraco", cls: "weak", p, ci, conf };
}

// ---- Dificuldade pessoal ----
export function historicalQuestionRows(db: DB, key: string): EnrichedRow[] {
  return officialRows(db).filter((x) => x.key === key);
}
export function contentHistoricalStats(db: DB, content: string) {
  const rr = officialRows(db).filter(
    (x) => (db.notes[`${x.attemptId}|${x.key}`]?.tag || x.content) === content && x.correct,
  );
  return {
    n: rr.length,
    c: rr.filter((x) => x.isCorrect).length,
    avgTime: rr.length ? Math.round(rr.reduce((s, x) => s + (x.timeSec || 0), 0) / rr.length) : 0,
  };
}
export function personalDifficulty(db: DB, q: Question): Difficulty {
  const k = questionKey(q),
    rr = historicalQuestionRows(db, k);
  if (rr.length) {
    const rate = pct(rr.filter((x) => x.isCorrect).length, rr.length),
      avg = rr.reduce((s, x) => s + (x.timeSec || 0), 0) / rr.length;
    if (rate >= 80 && avg < 150) return "facil";
    if (rate < 50 || avg > 240) return "dificil";
    return "media";
  }
  const cs = contentHistoricalStats(db, classifyContent(q));
  if (cs.n >= 5) {
    const rate = pct(cs.c, cs.n);
    if (rate >= 82) return "facil";
    if (rate < 55) return "dificil";
  }
  return "media";
}
export function difficultyLabel(d: Difficulty): [string, string] {
  return d === "facil"
    ? ["Fácil", "diffEasy"]
    : d === "dificil"
      ? ["Difícil", "diffHard"]
      : ["Média", "diffMedium"];
}
export function questionDifficultyFromRow(db: DB, row: ResultRow): Difficulty {
  const rr = historicalQuestionRows(db, row.key),
    rate = rr.length ? pct(rr.filter((x) => x.isCorrect).length, rr.length) : row.isCorrect ? 75 : 45,
    avg = rr.length ? rr.reduce((s, x) => s + (x.timeSec || 0), 0) / rr.length : row.timeSec;
  if (rate >= 80 && avg < 150) return "facil";
  if (rate < 50 || avg > 240) return "dificil";
  return "media";
}

// ---- Relatórios pós-prova ----
export function coherenceForAttempt(db: DB, a: Attempt) {
  const rows = a.result?.rows.filter((x) => x.correct) || [];
  let easy = 0,
    easyWrong = 0,
    hard = 0,
    hardCorrect = 0;
  rows.forEach((r) => {
    const d = questionDifficultyFromRow(db, r);
    if (d === "facil") {
      easy++;
      if (!r.isCorrect) easyWrong++;
    }
    if (d === "dificil") {
      hard++;
      if (r.isCorrect) hardCorrect++;
    }
  });
  const easyErr = easy ? easyWrong / easy : 0,
    score = Math.round(100 * (1 - easyErr * 0.9));
  return { score, label: score >= 85 ? "alta" : score >= 70 ? "média" : "baixa", easy, easyWrong, hard, hardCorrect };
}
export function fatigueForAttempt(a: Attempt) {
  const rows = a.result?.rows || [],
    n = rows.length,
    groups = [
      rows.slice(0, Math.ceil(n / 3)),
      rows.slice(Math.ceil(n / 3), Math.ceil((2 * n) / 3)),
      rows.slice(Math.ceil((2 * n) / 3)),
    ];
  return groups.map((g, i) => ({
    name: ["Início", "Meio", "Final"][i],
    p: g.length ? pct(g.filter((x) => x.isCorrect).length, g.filter((x) => x.correct).length || g.length) : 0,
    avg: g.length ? Math.round(g.reduce((s, x) => s + (x.timeSec || 0), 0) / g.length) : 0,
    n: g.length,
  }));
}

// ---- Sessões de estudo (gap de 90 min) ----
export function rebuildSessions(db: DB): StudySession[] {
  const arr = [...db.attempts]
    .filter((a) => a.startedAt)
    .sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt));
  const sessions: StudySession[] = [];
  let cur: StudySession | null = null;
  for (const a of arr) {
    const start = new Date(a.startedAt);
    const needNew =
      !cur ||
      start.toDateString() !== new Date(cur.lastAt).toDateString() ||
      +start - +new Date(cur.lastAt) > 90 * 60 * 1000;
    if (needNew) {
      cur = {
        id: `session_${start.toISOString().slice(0, 10)}_${sessions.length + 1}`,
        startedAt: a.startedAt,
        lastAt: a.finishedAt || a.startedAt,
        attemptIds: [],
        questions: 0,
        correct: 0,
        total: 0,
        reviews: 0,
        essays: 0,
        contents: {},
      };
      sessions.push(cur);
    }
    cur!.attemptIds.push(a.id);
    cur!.lastAt = a.finishedAt || a.startedAt;
    if (a.result) {
      cur!.questions += a.result.total || 0;
      cur!.correct += a.result.correct || 0;
      cur!.total += a.result.total || 0;
      if (a.mode === "srs" || a.mode === "retry" || a.mode === "srs-recall")
        cur!.reviews += a.result.total || 0;
      for (const r of a.result.rows || [])
        for (const t of (r.tags || [r.content]).filter(Boolean))
          cur!.contents[t] = (cur!.contents[t] || 0) + 1;
    }
    if (a.essay?.text?.trim()) cur!.essays++;
    a.sessionId = cur!.id;
  }
  return sessions;
}

// Série de evolução: média móvel de acerto ao longo das questões corrigidas.
export function evolutionSeries(db: DB, maxPoints = 30, window = 50): number[] {
  const rows = officialRows(db).filter((x) => x.correct);
  if (rows.length < 2) return [];
  const vals: number[] = [];
  const stepSize = Math.max(1, Math.floor(rows.length / maxPoints));
  for (let i = 0; i < rows.length; i += stepSize) {
    const sl = rows.slice(Math.max(0, i - (window - 1)), i + 1);
    vals.push(pct(sl.filter((x) => x.isCorrect).length, sl.length));
  }
  return vals;
}

export { discipline, classifyContent, questionKey, pct };
