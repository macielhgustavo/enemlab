// Motor adaptativo (portado do v6 beta final).
import { pct } from "../format";
import { classifyContent, questionKey } from "./classify";
import { DEFAULT_PROVIDER_ID, resolveProviderId } from "../providers/registry";
import {
  masteryStats,
  officialRowsOf,
  historicalQuestionRows,
} from "./stats";
import type { DB, Difficulty, Question } from "./types";

/**
 * Desempate estável baseado na identidade da questão.
 *
 * O motor antigo somava `Math.random() * 4`, portanto clicar duas vezes em
 * "Adaptive" com exatamente o mesmo histórico podia devolver outra fila. O
 * hash mantém uma pequena dispersão entre questões empatadas sem sacrificar
 * reprodutibilidade, testes ou explicabilidade.
 */
function stableTieBreak(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff * 4;
}

function adaptiveDifficulty(
  db: DB,
  q: Question,
  st: { c: number; t: number },
): Difficulty {
  const rows = historicalQuestionRows(db, questionKey(q));
  if (rows.length) {
    const rate = pct(rows.filter((row) => row.isCorrect).length, rows.length);
    const avg = rows.reduce((sum, row) => sum + (row.timeSec || 0), 0) / rows.length;
    if (rate >= 80 && avg < 150) return "facil";
    if (rate < 50 || avg > 240) return "dificil";
    return "media";
  }

  // `st` já veio de `masteryStats(db, providerId)`: para questões inéditas,
  // a dificuldade inferida nunca cruza histórico de outra prova com o mesmo
  // nome de conteúdo.
  if (st.t >= 5) {
    const rate = pct(st.c, st.t);
    if (rate >= 82) return "facil";
    if (rate < 55) return "dificil";
  }
  return "media";
}

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
    diff = adaptiveDifficulty(db, q, st);
  let score = (100 - acc) * 1.05 + Math.max(0, 8 - st.t) * 2.5;
  if (srs && new Date(srs.due) <= new Date()) score += 34;
  if (!seen.has(k)) score += 10;
  else score -= 10;
  if (days < 3) score -= 15;
  if (days > 21) score += 6;
  if (diff === "media") score += 3;
  if (diff === "dificil" && acc < 60) score -= 5;
  return score + stableTieBreak(k);
}

// Monta a fila adaptativa com teto por conteúdo (~30%).
/**
 * Fila adaptativa de uma prova. O histórico, o domínio e a diversidade de
 * assuntos são todos da mesma banca: cruzar provas faria o motor recomendar
 * com base em desempenho que não se compara.
 *
 * `classifyContent` também é usado em questões `reference-only`: quando há
 * metadado acadêmico revisado (por exemplo UNESP 2026), ele vence o fallback
 * textual e a fila trabalha por tópico real mesmo sem redistribuir enunciado.
 */
export function buildAdaptiveQuestions(
  db: DB,
  all: Question[],
  n = 15,
  providerId: string = DEFAULT_PROVIDER_ID,
): Question[] {
  const scopedProviderId = resolveProviderId(providerId);
  const stats = masteryStats(db, scopedProviderId),
    seen = new Set(officialRowsOf(db, scopedProviderId).map((x) => x.key));
  const ranked = all
    .map((q) => ({
      q,
      score: adaptiveScoreQuestion(db, q, stats, seen),
      content: classifyContent(q),
      key: questionKey(q),
    }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
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
  providerId: string;
  index: number;
  year: number;
  key: string;
  content: string;
  confidence: string | null;
  timeSec: number;
  attemptId: string;
  score: number;
}

// Fila de "erros a refazer", priorizada e isolada por prova.
export function adaptiveCandidates(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
): Candidate[] {
  const scopedProviderId = resolveProviderId(providerId);
  const ms = masteryStats(db, scopedProviderId);
  return officialRowsOf(db, scopedProviderId)
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
        providerId: scopedProviderId,
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
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}
