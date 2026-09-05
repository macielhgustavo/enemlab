// Motor adaptativo (portado do v6 beta final).
import { pct } from "../format";
import { classifyContent, questionKey } from "./classify";
import {
  masteryStats,
  officialRows,
  personalDifficulty,
  historicalQuestionRows,
} from "./stats";
import type { DB, Question } from "./types";

// Pontua uma questão pela urgência de treino: fraqueza no conteúdo,
// amostra pequena, SRS vencido, ineditismo, recência e dificuldade.
export function adaptiveScoreQuestion(
  db: DB,
  q: Question,
  stats: Record<string, { c: number; t: number }>,
  seen: Set<string>,
): number {
  const content = classifyContent(q),
    st = stats[content] || { c: 0, t: 0 },
    acc = st.t ? pct(st.c, st.t) : 55,
    k = questionKey(q),
    srs = db.srs[k],
    rr = historicalQuestionRows(db, k),
    last = rr.length ? Math.max(...rr.map((x) => +new Date(x.finishedAt || 0))) : 0,
    days = last ? (Date.now() - last) / 86400000 : 999,
    diff = personalDifficulty(db, q);
  let score = (100 - acc) * 1.05 + Math.max(0, 8 - st.t) * 2.5;
  if (srs && new Date(srs.due) <= new Date()) score += 34;
  if (!seen.has(k)) score += 10;
  else score -= 10;
  if (days < 3) score -= 15;
  if (days > 21) score += 6;
  if (diff === "media") score += 3;
  if (diff === "dificil" && acc < 60) score -= 5;
  return score + Math.random() * 4;
}

// Monta a fila adaptativa com teto por conteúdo (~30%).
export function buildAdaptiveQuestions(db: DB, all: Question[], n = 15): Question[] {
  const stats = masteryStats(db),
    seen = new Set(officialRows(db).map((x) => x.key));
  const ranked = all
    .map((q) => ({ q, score: adaptiveScoreQuestion(db, q, stats, seen), content: classifyContent(q) }))
    .sort((a, b) => b.score - a.score);
  const chosen: Question[] = [],
    perContent: Record<string, number> = {};
  const capPerContent = Math.max(3, Math.ceil(n * 0.3));
  for (const x of ranked) {
    if ((perContent[x.content] || 0) >= capPerContent) continue;
    chosen.push(x.q);
    perContent[x.content] = (perContent[x.content] || 0) + 1;
    if (chosen.length >= n) break;
  }
  return chosen;
}

export interface Candidate {
  index: number;
  year: number;
  key: string;
  content: string;
  confidence: string | null;
  timeSec: number;
  attemptId: string;
  score: number;
}
// Fila de "erros a refazer", priorizada.
export function adaptiveCandidates(db: DB): Candidate[] {
  const ms = masteryStats(db);
  return officialRows(db)
    .filter((x) => x.isCorrect === false)
    .map((x) => {
      const note = db.notes[`${x.attemptId}|${x.key}`] || {};
      const content = (note.tag && note.tag.trim()) || x.content;
      const st = ms[content] || { c: 0, t: 0 };
      const acc = st.t ? pct(st.c, st.t) : 50;
      const score =
        100 -
        acc +
        (x.confidence === "certeza" ? 25 : x.confidence === "duvida" ? 10 : 0) +
        (x.timeSec > 180 ? 8 : 0) +
        (note.reason === "Conteúdo" ? 12 : note.reason === "Cálculo" ? 7 : 0);
      return {
        index: x.index,
        year: x.year,
        key: x.key,
        content,
        confidence: x.confidence,
        timeSec: x.timeSec,
        attemptId: x.attemptId,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}
