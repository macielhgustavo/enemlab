import { pct } from "../format";
import { DEFAULT_PROVIDER_ID, sameProvider } from "../providers/registry";
import { dueSRS } from "./srs";
import { isHighStudentAIAssistance } from "./ai-assistance";
import {
  masteryStats,
  officialRowsOf,
  questionTagsByRow,
  wilsonInterval,
} from "./stats";
import type { DB, ResultRow } from "./types";

export type DailyPlanBlockKind = "srs" | "validation" | "weak" | "adaptive" | "unseen";

export interface DailyPlanBlock {
  id: string;
  kind: DailyPlanBlockKind;
  priority: number;
  title: string;
  eyebrow: string;
  reason: string;
  questions: number;
  minutes: number;
  content?: string;
  metric?: string;
  aiAllowed?: boolean;
}

export interface DailyPlanSignals {
  dueReviews: number;
  questionsToday: number;
  minutesToday: number;
  weeklyQuestions: number;
  weeklyTarget: number;
  paceDeficit: number;
  completedPlanBlocks: number;
  highConfidenceErrors: number;
  assistedTopicsToValidate: number;
}

export interface DailyPlan {
  dateKey: string;
  budgetMinutes: number;
  remainingMinutes: number;
  avgQuestionMinutes: number;
  targetToday: number;
  signals: DailyPlanSignals;
  blocks: DailyPlanBlock[];
  totalQuestions: number;
  totalMinutes: number;
}

interface WeakPriority {
  name: string;
  c: number;
  t: number;
  p: number;
  low: number;
  high: number;
  certainWrong: number;
  score: number;
}

interface ValidationPriority {
  name: string;
  rawAccuracy: number;
  independentAccuracy: number;
  independentQuestions: number;
  highAssistanceQuestions: number;
  correctWithHighAssistance: number;
  correctWithHighAssistanceShare: number;
  gap: number;
  score: number;
}

const MIN_BUDGET = 20;
const MAX_BUDGET = 240;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sameLocalDay(iso: string | null | undefined, key: string): boolean {
  return !!iso && localDateKey(new Date(iso)) === key;
}

function mondayStart(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function completedAttempts(db: DB, providerId: string = DEFAULT_PROVIDER_ID) {
  return db.attempts.filter(
    (a) => a.result && a.finishedAt && sameProvider(a.providerId, providerId),
  );
}

export function estimatedQuestionMinutes(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
): number {
  const times = officialRowsOf(db, providerId)
    .map((row) => row.timeSec)
    .filter((sec) => Number.isFinite(sec) && sec >= 20 && sec <= 600)
    .slice(-100)
    .sort((a, b) => a - b);
  if (!times.length) return 3;
  const mid = Math.floor(times.length / 2);
  const median = times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2;
  return Math.round(clamp(median / 60, 1.5, 5.5) * 10) / 10;
}

function weakPriorities(db: DB, providerId: string = DEFAULT_PROVIDER_ID): WeakPriority[] {
  const mastery = masteryStats(db, providerId);
  const recent = officialRowsOf(db, providerId).slice(-120);

  return Object.entries(mastery)
    .filter(([, value]) => value.t >= 2)
    .map(([name, value]) => {
      const ci = wilsonInterval(value.c, value.t);
      const certainWrong = recent.filter(
        (row) =>
          row.isCorrect === false &&
          row.confidence === "certeza" &&
          questionTagsByRow(db, row).includes(name),
      ).length;
      const p = pct(value.c, value.t);
      const samplePressure = value.t < 8 ? 8 : value.t < 15 ? 3 : 0;
      const score = 100 - ci.low + certainWrong * 7 + samplePressure;
      return {
        name,
        ...value,
        p,
        low: ci.low,
        high: ci.high,
        certainWrong,
        score,
      };
    })
    .filter((item) => item.p < 82 || item.low < 70 || item.certainWrong > 0)
    .sort((a, b) => b.score - a.score || a.p - b.p || b.t - a.t);
}

function traceForRow(db: DB, row: ResultRow) {
  if (!row.attemptId) return undefined;
  return db.attempts.find((attempt) => attempt.id === row.attemptId)?.aiAssistance?.[row.key];
}

/**
 * Procura conteúdos cujo acerto bruto parece saudável, mas cuja evidência
 * independente é materialmente menor por causa de assistência alta. Requer
 * amostra mínima para evitar reagir a um único uso casual do tutor.
 */
export function validationPriorities(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
): ValidationPriority[] {
  const rows = officialRowsOf(db, providerId).filter(
    (row) => !!row.correct && typeof row.isCorrect === "boolean",
  );
  const mastery = masteryStats(db, providerId);

  return Object.entries(mastery)
    .filter(([, value]) => value.t >= 4)
    .map(([name, value]) => {
      const itemRows = rows.filter((row) => questionTagsByRow(db, row).includes(name));
      let independentQuestions = 0;
      let independentCorrect = 0;
      let highAssistanceQuestions = 0;
      let correctWithHighAssistance = 0;

      for (const row of itemRows) {
        const high = isHighStudentAIAssistance(traceForRow(db, row));
        if (high) {
          highAssistanceQuestions++;
          if (row.isCorrect) correctWithHighAssistance++;
          continue;
        }
        independentQuestions++;
        if (row.isCorrect) independentCorrect++;
      }

      const rawAccuracy = pct(value.c, value.t);
      const independentAccuracy = independentQuestions
        ? pct(independentCorrect, independentQuestions)
        : 0;
      const correctWithHighAssistanceShare = value.c
        ? pct(correctWithHighAssistance, value.c)
        : 0;
      const gap = Math.max(0, rawAccuracy - independentAccuracy);
      const score = gap * 2 + correctWithHighAssistanceShare + highAssistanceQuestions * 4;

      return {
        name,
        rawAccuracy,
        independentAccuracy,
        independentQuestions,
        highAssistanceQuestions,
        correctWithHighAssistance,
        correctWithHighAssistanceShare,
        gap,
        score,
      };
    })
    .filter(
      (item) =>
        item.rawAccuracy >= 70 &&
        item.independentQuestions >= 2 &&
        item.correctWithHighAssistance >= 1 &&
        (item.gap >= 10 || item.correctWithHighAssistanceShare >= 25),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.gap - a.gap ||
        b.correctWithHighAssistanceShare - a.correctWithHighAssistanceShare,
    );
}

function addBlock(blocks: DailyPlanBlock[], block: DailyPlanBlock, remaining: number): number {
  if (block.minutes > remaining || block.questions <= 0) return remaining;
  blocks.push(block);
  return Math.max(0, remaining - block.minutes);
}

/**
 * Plano do dia da prova ativa. Ritmo, fila, fraquezas e metas saem todos da
 * mesma banca — misturar faria o plano recomendar com base em desempenho que
 * não se compara.
 */
export function buildDailyPlan(
  db: DB,
  requestedBudget = 60,
  now = new Date(),
  providerId: string = DEFAULT_PROVIDER_ID,
): DailyPlan {
  const budgetMinutes = clamp(Math.round(requestedBudget || 60), MIN_BUDGET, MAX_BUDGET);
  const dateKey = localDateKey(now);
  const finished = completedAttempts(db, providerId);
  const today = finished.filter((a) => sameLocalDay(a.finishedAt, dateKey));
  const minutesToday = Math.round(
    today.reduce((sum, a) => sum + Math.max(0, a.elapsed || a.questionSec || 0), 0) / 60,
  );
  const questionsToday = today.reduce((sum, a) => sum + (a.result?.total || 0), 0);

  const weekStart = mondayStart(now);
  const week = finished.filter((a) => new Date(a.finishedAt!) >= weekStart && new Date(a.finishedAt!) <= now);
  const weeklyQuestions = week.reduce((sum, a) => sum + (a.result?.total || 0), 0);
  const weeklyTarget = Math.max(0, db.goals.questions || 0);
  const dayOfWeek = (now.getDay() + 6) % 7;
  const expectedByNow = Math.round((weeklyTarget * (dayOfWeek + 1)) / 7);
  const paceDeficit = Math.max(0, expectedByNow - weeklyQuestions);
  const baseDailyTarget = Math.max(5, Math.round(weeklyTarget / 7));
  const targetToday = Math.max(baseDailyTarget, Math.min(baseDailyTarget * 2, paceDeficit));

  const due = dueSRS(db, providerId);
  const avgQuestionMinutes = estimatedQuestionMinutes(db, providerId);
  const weak = weakPriorities(db, providerId);
  const validations = validationPriorities(db, providerId);
  const highConfidenceErrors = weak.reduce((sum, item) => sum + item.certainWrong, 0);
  const completedPlanBlocks = today.filter((a) => a.plan?.source === "daily-plan").length;

  let remaining = Math.max(0, budgetMinutes - minutesToday);
  const blocks: DailyPlanBlock[] = [];

  if (remaining >= 6 && due.length) {
    const reviewMinute = clamp(avgQuestionMinutes * 0.72, 1.2, 2.8);
    const maxReviewMinutes = Math.min(remaining, Math.max(10, Math.round(remaining * 0.42)), 30);
    const questions = Math.min(due.length, 15, Math.max(3, Math.floor(maxReviewMinutes / reviewMinute)));
    const minutes = Math.max(6, Math.round(questions * reviewMinute));
    remaining = addBlock(
      blocks,
      {
        id: `srs-${dateKey}`,
        kind: "srs",
        priority: 1,
        eyebrow: "retenção",
        title: `Revisar ${questions} ${questions === 1 ? "item vencido" : "itens vencidos"}`,
        reason: `${due.length} revisão(ões) estão vencidas. O plano protege retenção antes de adicionar volume novo.`,
        questions,
        minutes,
        metric: `${due.length} na fila`,
      },
      remaining,
    );
  }

  // O sprint focado por conteúdo ainda usa o banco textual do ENEM. Quando os
  // demais providers tiverem banco nativo equivalente, esta restrição pode cair.
  if (providerId === DEFAULT_PROVIDER_ID && validations.length && remaining >= 12) {
    const item = validations[0];
    const questions = clamp(Math.floor(Math.min(24, remaining * 0.4) / avgQuestionMinutes), 4, 7);
    const minutes = Math.max(10, Math.round(questions * avgQuestionMinutes));
    remaining = addBlock(
      blocks,
      {
        id: `validation-${slug(item.name)}-${dateKey}`,
        kind: "validation",
        priority: 2,
        eyebrow: "validação sem IA",
        title: item.name,
        reason: `Acerto bruto ${item.rawAccuracy}%, mas ${item.independentAccuracy}% nas ${item.independentQuestions} questão(ões) sem assistência alta. Faça uma amostra curta sem tutor antes de tratar esse desempenho como consolidado.`,
        questions,
        minutes,
        content: item.name,
        metric: `${item.gap} p.p. de diferença`,
        aiAllowed: false,
      },
      remaining,
    );
  }

  for (const item of weak.slice(0, 2)) {
    if (remaining < 12) break;
    if (blocks.some((block) => block.kind === "validation" && block.content === item.name)) continue;
    const targetMinutes = Math.min(28, Math.max(12, Math.round(remaining * 0.48)));
    const questions = clamp(Math.floor(targetMinutes / avgQuestionMinutes), 4, 10);
    const minutes = Math.max(10, Math.round(questions * avgQuestionMinutes));
    const certain = item.certainWrong
      ? ` Há ${item.certainWrong} erro(s) recente(s) com alta confiança.`
      : "";
    remaining = addBlock(
      blocks,
      {
        id: `weak-${slug(item.name)}-${dateKey}`,
        kind: "weak",
        priority: 3,
        eyebrow: "conteúdo frágil",
        title: item.name,
        reason: `Acerto ${item.p}% em ${item.t} questão(ões); IC95% ${item.low}–${item.high}%.${certain}`,
        questions,
        minutes,
        content: item.name,
        metric: `${item.p}% · n=${item.t}`,
      },
      remaining,
    );
  }

  const questionsNeededToday = Math.max(0, targetToday - questionsToday);
  if (remaining >= 12) {
    const n = clamp(Math.floor(remaining / avgQuestionMinutes), 5, 15);
    const minutes = Math.max(10, Math.round(n * avgQuestionMinutes));
    remaining = addBlock(
      blocks,
      {
        id: `adaptive-${dateKey}`,
        kind: "adaptive",
        priority: 4,
        eyebrow: "calibração adaptativa",
        title: `Adaptive · ${n} questões`,
        reason:
          weak.length || due.length || validations.length
            ? "Fecha a sessão misturando fraqueza, amostra pequena, recência, ineditismo e dificuldade pessoal."
            : "Sem gargalo forte detectado: use o Adaptive para ampliar a amostra e encontrar a próxima prioridade.",
        questions: n,
        minutes,
        metric: questionsNeededToday ? `${questionsNeededToday} para o ritmo de hoje` : "ritmo diário em dia",
      },
      remaining,
    );
  }

  if (
    remaining >= Math.round(avgQuestionMinutes * 15) &&
    questionsToday < targetToday &&
    blocks.length < 4
  ) {
    const minutes = Math.round(avgQuestionMinutes * 15);
    remaining = addBlock(
      blocks,
      {
        id: `unseen-${dateKey}`,
        kind: "unseen",
        priority: 5,
        eyebrow: "volume novo",
        title: "15 questões inéditas",
        reason: `Você está ${questionsNeededToday} questão(ões) abaixo do alvo calculado para hoje; este bloco amplia a amostra sem repetir itens já vistos.`,
        questions: 15,
        minutes,
        metric: `${weeklyQuestions}/${weeklyTarget || "—"} na semana`,
      },
      remaining,
    );
  }

  const totalQuestions = blocks.reduce((sum, block) => sum + block.questions, 0);
  const totalMinutes = blocks.reduce((sum, block) => sum + block.minutes, 0);

  return {
    dateKey,
    budgetMinutes,
    remainingMinutes: Math.max(0, budgetMinutes - minutesToday),
    avgQuestionMinutes,
    targetToday,
    signals: {
      dueReviews: due.length,
      questionsToday,
      minutesToday,
      weeklyQuestions,
      weeklyTarget,
      paceDeficit,
      completedPlanBlocks,
      highConfidenceErrors,
      assistedTopicsToValidate: validations.length,
    },
    blocks,
    totalQuestions,
    totalMinutes,
  };
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
