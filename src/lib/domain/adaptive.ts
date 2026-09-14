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
  return ((hash >>> 0) / 0xffffffff) * 4;
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

export interface AdaptiveScoreComponents {
  weakness: number;
  sample: number;
  overdueReview: number;
  novelty: number;
  spacing: number;
  difficulty: number;
  tieBreak: number;
}

export interface AdaptiveDecision {
  key: string;
  content: string;
  score: number;
  accuracy: number;
  attemptsInContent: number;
  seen: boolean;
  overdue: boolean;
  difficulty: Difficulty;
  daysSinceQuestion: number | null;
  components: AdaptiveScoreComponents;
  reasons: string[];
}

export interface AdaptiveSelectionItem {
  question: Question;
  decision: AdaptiveDecision;
}

function sumComponents(components: AdaptiveScoreComponents): number {
  return Object.values(components).reduce((sum, value) => sum + value, 0);
}

/**
 * Explica a pontuação de uma questão sem mudar a heurística histórica.
 *
 * `now` é injetável para que uma fila inteira use o mesmo relógio e para que
 * testes consigam reproduzir exatamente a decisão. O desempate continua
 * derivado apenas da identidade da questão.
 */
export function adaptiveDecision(
  db: DB,
  q: Question,
  stats: Record<string, { c: number; t: number }>,
  seen: Set<string>,
  now: Date = new Date(),
): AdaptiveDecision {
  const content = classifyContent(q);
  const st = stats[content] || { c: 0, t: 0 };
  const accuracy = st.t ? pct(st.c, st.t) : 55;
  const key = questionKey(q);
  const srs = db.srs[key];
  const rows = historicalQuestionRows(db, key);
  const last = rows.length ? Math.max(...rows.map((row) => +new Date(row.finishedAt || 0))) : 0;
  const nowMs = now.getTime();
  const daysSinceQuestion = last ? Math.max(0, (nowMs - last) / 86400000) : null;
  // O motor anterior tratava uma questão nunca vista como 999 dias desde a
  // última resolução. Mantemos a mesma semântica para não mudar a ordenação.
  const daysForScore = daysSinceQuestion ?? 999;
  const difficulty = adaptiveDifficulty(db, q, st);
  const isSeen = seen.has(key);
  const overdue = Boolean(srs && Number.isFinite(+new Date(srs.due)) && +new Date(srs.due) <= nowMs);

  const components: AdaptiveScoreComponents = {
    weakness: (100 - accuracy) * 1.05,
    sample: Math.max(0, 8 - st.t) * 2.5,
    overdueReview: overdue ? 34 : 0,
    novelty: isSeen ? -10 : 10,
    spacing: daysForScore < 3 ? -15 : daysForScore > 21 ? 6 : 0,
    difficulty: difficulty === "media" ? 3 : difficulty === "dificil" && accuracy < 60 ? -5 : 0,
    tieBreak: stableTieBreak(key),
  };

  const reasons: string[] = [];
  if (accuracy < 65) reasons.push(`Conteúdo frágil: ${accuracy}% de acerto.`);
  else if (st.t === 0) reasons.push("Sem amostra deste conteúdo; precisa de calibração.");
  if (st.t < 8) reasons.push(`Amostra pequena: ${st.t} questão(ões) no conteúdo.`);
  if (overdue) reasons.push("Revisão vencida: retenção tem prioridade.");
  if (!isSeen) reasons.push("Questão inédita para ampliar a amostra.");
  else if (daysForScore < 3) reasons.push("Vista recentemente; recebe penalidade de recência.");
  else if (daysForScore > 21) reasons.push("Faz tempo desde a última tentativa.");
  if (difficulty === "dificil" && accuracy < 60) {
    reasons.push("Dificuldade alta com domínio baixo; evita sobrecarga prematura.");
  }

  return {
    key,
    content,
    score: sumComponents(components),
    accuracy,
    attemptsInContent: st.t,
    seen: isSeen,
    overdue,
    difficulty,
    daysSinceQuestion,
    components,
    reasons,
  };
}

// Pontua uma questão pela urgência de treino: fraqueza no conteúdo,
// amostra pequena, SRS vencido, ineditismo, recência e dificuldade.
export function adaptiveScoreQuestion(
  db: DB,
  q: Question,
  stats: Record<string, { c: number; t: number }>,
  seen: Set<string>,
  now: Date = new Date(),
): number {
  return adaptiveDecision(db, q, stats, seen, now).score;
}

/**
 * Retorna as questões escolhidas junto com a decisão que justificou cada uma.
 * A diversidade continua limitada a ~30% por conteúdo.
 */
export function buildAdaptiveSelection(
  db: DB,
  all: Question[],
  n = 15,
  providerId: string = DEFAULT_PROVIDER_ID,
  now: Date = new Date(),
): AdaptiveSelectionItem[] {
  const scopedProviderId = resolveProviderId(providerId);
  const stats = masteryStats(db, scopedProviderId);
  const seen = new Set(officialRowsOf(db, scopedProviderId).map((row) => row.key));
  const ranked = all
    .map((question) => ({
      question,
      decision: adaptiveDecision(db, question, stats, seen, now),
    }))
    .sort(
      (a, b) =>
        b.decision.score - a.decision.score ||
        a.decision.key.localeCompare(b.decision.key),
    );

  const chosen: AdaptiveSelectionItem[] = [];
  const perContent: Record<string, number> = {};
  const capPerContent = Math.max(3, Math.ceil(n * 0.3));
  for (const item of ranked) {
    const content = item.decision.content;
    if ((perContent[content] || 0) >= capPerContent) continue;
    chosen.push(item);
    perContent[content] = (perContent[content] || 0) + 1;
    if (chosen.length >= n) break;
  }
  return chosen;
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
  now: Date = new Date(),
): Question[] {
  return buildAdaptiveSelection(db, all, n, providerId, now).map((item) => item.question);
}

export interface RetryScoreComponents {
  contentGap: number;
  confidence: number;
  slow: number;
  diagnosedReason: number;
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
  components: RetryScoreComponents;
  reasons: string[];
}

// Fila de "erros a refazer", priorizada e isolada por prova.
export function adaptiveCandidates(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
): Candidate[] {
  const scopedProviderId = resolveProviderId(providerId);
  const ms = masteryStats(db, scopedProviderId);
  return officialRowsOf(db, scopedProviderId)
    .filter((row) => row.isCorrect === false)
    .map((row) => {
      const note = db.notes[`${row.attemptId}|${row.key}`] || {};
      const content = (note.tag && note.tag.trim()) || row.content;
      const st = ms[content] || { c: 0, t: 0 };
      const accuracy = st.t ? pct(st.c, st.t) : 50;
      const components: RetryScoreComponents = {
        contentGap: 100 - accuracy,
        confidence: row.confidence === "certeza" ? 25 : row.confidence === "duvida" ? 10 : 0,
        slow: row.timeSec > 180 ? 8 : 0,
        diagnosedReason: note.reason === "Conteúdo" ? 12 : note.reason === "Cálculo" ? 7 : 0,
      };
      const reasons = [
        `Domínio do conteúdo: ${accuracy}% de acerto.`,
        ...(row.confidence === "certeza"
          ? ["Erro com certeza: forte sinal de falsa confiança."]
          : row.confidence === "duvida"
            ? ["Erro com dúvida: precisa de consolidação."]
            : []),
        ...(row.timeSec > 180 ? ["Tempo alto na questão: recuperação custosa."] : []),
        ...(note.reason === "Conteúdo"
          ? ["Revisão marcada como erro de conteúdo."]
          : note.reason === "Cálculo"
            ? ["Revisão marcada como erro de cálculo."]
            : []),
      ];
      return {
        providerId: scopedProviderId,
        index: row.index,
        year: row.year,
        key: row.key,
        content,
        confidence: row.confidence,
        timeSec: row.timeSec,
        attemptId: row.attemptId,
        score: Object.values(components).reduce((sum, value) => sum + value, 0),
        components,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}
