import { pct } from "../format";
import { DEFAULT_PROVIDER_ID, resolveProviderId, sameProvider } from "../providers/registry";
import { classifyContent, isUnclassifiedContent } from "./classify";
import {
  officialRowsOf,
  questionTagsByRow,
  wilsonInterval,
  type EnrichedRow,
  type Wilson,
} from "./stats";
import type { DB, Question, ResultRow } from "./types";

export const MIN_ACTIONABLE_EVIDENCE = 4;

export type EvidenceLevel = "baixa" | "media" | "alta";

export interface ContentEvidence {
  content: string;
  correct: number;
  total: number;
  accuracy: number;
  interval: Wilson;
  evidenceScore: number;
  confidence: EvidenceLevel;
  latestAt: string | null;
  recentAccuracy: number | null;
}

export interface CoverageSnapshot {
  expected: number | null;
  observed: number;
  calibrated: number;
  calibrating: number;
  untested: number | null;
  observedPct: number | null;
  calibratedPct: number | null;
  contents: Array<{
    content: string;
    state: "untested" | "calibrating" | "calibrated";
    attempts: number;
    accuracy: number | null;
  }>;
}

export interface FalseMasterySignal {
  content: string;
  accuracy: number;
  total: number;
  hardAccuracy: number | null;
  hardTotal: number;
  recentAccuracy: number | null;
  risk: number;
  reasons: string[];
}

export interface FalseErrorSignal {
  key: string;
  attemptId: string;
  content: string;
  overallAccuracy: number;
  sample: number;
  confidence: string | null;
  likelyExecutionNoise: boolean;
  reasons: string[];
}

export interface KnowledgeExecutionSplit {
  actualAccuracy: number;
  knowledgeScore: number;
  executionScore: number;
  total: number;
  knowledgeSample: number;
  executionErrors: number;
  slowRows: number;
  diagnosis: "conhecimento" | "execucao" | "misto" | "calibrando";
}

export interface TemporalBucket {
  id: "madrugada" | "manha" | "tarde" | "noite";
  label: string;
  correct: number;
  total: number;
  accuracy: number | null;
}

export interface TemporalProfile {
  buckets: TemporalBucket[];
  bestBucket: TemporalBucket | null;
  fatigueThresholdMinutes: number | null;
  fatiguedAttempts: number;
  analyzedAttempts: number;
}

export interface ReadinessSnapshot {
  score: number;
  confidence: EvidenceLevel;
  label: "inicial" | "em construcao" | "consistente" | "forte";
  components: {
    knowledge: number;
    retention: number;
    coverage: number;
    execution: number;
    evidence: number;
  };
  sample: number;
  note: string;
  risks: string[];
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function normalizedTags(db: DB, row: EnrichedRow): string[] {
  return [...new Set(questionTagsByRow(db, row).map((tag) => tag.trim()).filter(Boolean))].filter(
    (tag) => !isUnclassifiedContent(tag),
  );
}

function rowsByContent(db: DB, providerId: string): Map<string, EnrichedRow[]> {
  const out = new Map<string, EnrichedRow[]>();
  for (const row of officialRowsOf(db, providerId).filter((item) => item.correct)) {
    for (const tag of normalizedTags(db, row)) {
      const rows = out.get(tag) ?? [];
      rows.push(row);
      out.set(tag, rows);
    }
  }
  return out;
}

function latestTimestamp(rows: EnrichedRow[]): number {
  return rows.reduce((latest, row) => {
    const value = row.finishedAt ? +new Date(row.finishedAt) : 0;
    return Number.isFinite(value) ? Math.max(latest, value) : latest;
  }, 0);
}

function evidenceLevel(total: number, width: number, score: number): EvidenceLevel {
  if (total < MIN_ACTIONABLE_EVIDENCE || score < 48) return "baixa";
  if (total >= 15 && width <= 35 && score >= 75) return "alta";
  return "media";
}

/**
 * Confiança da evidência, não confiança de que o aluno "é bom" ou "é ruim".
 * Amostra, largura do IC e recência entram separadamente para não transformar
 * duas respostas recentes em uma conclusão forte.
 */
export function contentEvidence(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
  now = new Date(),
): ContentEvidence[] {
  const scoped = resolveProviderId(providerId);
  const grouped = rowsByContent(db, scoped);
  const nowMs = now.getTime();

  return [...grouped.entries()]
    .map(([content, rows]) => {
      const correct = rows.filter((row) => row.isCorrect).length;
      const total = rows.length;
      const interval = wilsonInterval(correct, total);
      const latest = latestTimestamp(rows);
      const ageDays = latest ? Math.max(0, (nowMs - latest) / 86400000) : 999;
      const recent = rows.slice(-5);
      const recentAccuracy = recent.length
        ? pct(recent.filter((row) => row.isCorrect).length, recent.length)
        : null;
      const sampleScore = Math.min(55, total * 5);
      const precisionScore = Math.max(0, 30 - interval.width * 0.55);
      const recencyScore = ageDays <= 14 ? 15 : ageDays <= 45 ? 9 : ageDays <= 90 ? 4 : 0;
      const evidenceScore = Math.round(clamp(sampleScore + precisionScore + recencyScore));
      return {
        content,
        correct,
        total,
        accuracy: pct(correct, total),
        interval,
        evidenceScore,
        confidence: evidenceLevel(total, interval.width, evidenceScore),
        latestAt: latest ? new Date(latest).toISOString() : null,
        recentAccuracy,
      };
    })
    .sort((a, b) => b.evidenceScore - a.evidenceScore || b.total - a.total || a.content.localeCompare(b.content));
}

export function evidenceForContent(
  db: DB,
  content: string,
  providerId: string = DEFAULT_PROVIDER_ID,
  now = new Date(),
): ContentEvidence | null {
  return contentEvidence(db, providerId, now).find((item) => item.content === content) ?? null;
}

export function expectedContentsFromQuestions(questions: Question[]): string[] {
  return [...new Set(questions.map(classifyContent).filter((name) => name && !isUnclassifiedContent(name)))].sort();
}

/**
 * Cobertura real só recebe porcentagem quando existe um denominador conhecido
 * (por exemplo, conteúdos presentes no banco da edição). Sem isso retornamos
 * `null` em vez de inventar que o histórico observado é o edital inteiro.
 */
export function coverageSnapshot(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
  expectedContents?: string[],
): CoverageSnapshot {
  const evidence = contentEvidence(db, providerId);
  const byName = new Map(evidence.map((item) => [item.content, item]));
  const expected = expectedContents?.length
    ? [...new Set(expectedContents.filter((name) => name && !isUnclassifiedContent(name)))].sort()
    : null;
  const names = expected ?? [...byName.keys()].sort();
  const contents = names.map((content) => {
    const item = byName.get(content);
    const attempts = item?.total ?? 0;
    return {
      content,
      state: attempts === 0 ? "untested" as const : attempts < MIN_ACTIONABLE_EVIDENCE ? "calibrating" as const : "calibrated" as const,
      attempts,
      accuracy: item?.accuracy ?? null,
    };
  });
  const observed = contents.filter((item) => item.attempts > 0).length;
  const calibrated = contents.filter((item) => item.state === "calibrated").length;
  const calibrating = contents.filter((item) => item.state === "calibrating").length;
  const total = expected?.length ?? null;

  return {
    expected: total,
    observed,
    calibrated,
    calibrating,
    untested: total === null ? null : Math.max(0, total - observed),
    observedPct: total ? Math.round((observed / total) * 100) : null,
    calibratedPct: total ? Math.round((calibrated / total) * 100) : null,
    contents,
  };
}

function isExecutionReason(reason?: string): boolean {
  return reason === "Desatenção" || reason === "Tempo/pressa";
}

function rowNote(db: DB, row: EnrichedRow) {
  return db.notes[`${row.attemptId}|${row.key}`] ?? {};
}

function isHardRow(row: ResultRow): boolean {
  return row.difficulty === "dificil" || row.timeSec >= 240;
}

/** Detecta domínio aparente que ainda não se sustenta sob dificuldade/recência. */
export function falseMasterySignals(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
): FalseMasterySignal[] {
  const grouped = rowsByContent(db, resolveProviderId(providerId));
  const out: FalseMasterySignal[] = [];

  for (const [content, rows] of grouped) {
    if (rows.length < 6) continue;
    const accuracy = pct(rows.filter((row) => row.isCorrect).length, rows.length);
    if (accuracy < 75) continue;
    const hard = rows.filter(isHardRow);
    const hardAccuracy = hard.length ? pct(hard.filter((row) => row.isCorrect).length, hard.length) : null;
    const recent = rows.slice(-4);
    const recentAccuracy = recent.length ? pct(recent.filter((row) => row.isCorrect).length, recent.length) : null;
    const interval = wilsonInterval(rows.filter((row) => row.isCorrect).length, rows.length);
    const reasons: string[] = [];
    let risk = 0;

    if (hard.length >= 2 && hardAccuracy !== null && hardAccuracy < 60) {
      risk += 55;
      reasons.push(`Acerto cai para ${hardAccuracy}% nas questões mais custosas/difíceis.`);
    }
    if (recent.length >= 3 && recentAccuracy !== null && recentAccuracy + 20 < accuracy) {
      risk += 25;
      reasons.push(`As últimas questões ficaram em ${recentAccuracy}%, abaixo do histórico de ${accuracy}%.`);
    }
    if (interval.low < 65) {
      risk += 20;
      reasons.push(`O IC95% ainda permite desempenho abaixo de 65% (${interval.low}–${interval.high}%).`);
    }
    if (!reasons.length) continue;

    out.push({
      content,
      accuracy,
      total: rows.length,
      hardAccuracy,
      hardTotal: hard.length,
      recentAccuracy,
      risk: clamp(risk),
      reasons,
    });
  }

  return out.sort((a, b) => b.risk - a.risk || a.content.localeCompare(b.content));
}

/**
 * Marca erros que provavelmente não justificam rebaixar o domínio inteiro.
 * Eles continuam sendo erros reais; o sinal apenas evita confundir um tropeço
 * isolado de execução com desconhecimento consolidado.
 */
export function falseErrorSignals(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
): FalseErrorSignal[] {
  const evidence = new Map(contentEvidence(db, providerId).map((item) => [item.content, item]));
  const rows = officialRowsOf(db, providerId).filter((row) => row.isCorrect === false);

  return rows
    .map((row) => {
      const tags = normalizedTags(db, row);
      const content = tags[0] || row.content;
      const base = evidence.get(content);
      const note = rowNote(db, row);
      const executionReason = note.knew === "pressa" || isExecutionReason(note.reason);
      const difficult = isHardRow(row);
      const strongHistory = Boolean(base && base.total >= 6 && base.accuracy >= 75);
      const certaintyAgainstNoise = row.confidence === "certeza" && !executionReason;
      const likelyExecutionNoise = strongHistory && !certaintyAgainstNoise && (executionReason || difficult || row.confidence === "chute");
      const reasons: string[] = [];
      if (strongHistory && base) reasons.push(`O conteúdo tem ${base.accuracy}% em n=${base.total}.`);
      if (executionReason) reasons.push("O próprio diagnóstico aponta falha de execução, não de conteúdo.");
      if (difficult) reasons.push("A questão foi difícil/custosa pelo histórico ou pelo tempo gasto.");
      if (row.confidence === "certeza" && !executionReason) reasons.push("Erro com certeza continua sendo sinal forte de conceito equivocado.");
      return {
        key: row.key,
        attemptId: row.attemptId,
        content,
        overallAccuracy: base?.accuracy ?? 0,
        sample: base?.total ?? 0,
        confidence: row.confidence,
        likelyExecutionNoise,
        reasons,
      };
    })
    .filter((item) => item.sample >= MIN_ACTIONABLE_EVIDENCE)
    .sort((a, b) => Number(b.likelyExecutionNoise) - Number(a.likelyExecutionNoise) || b.sample - a.sample);
}

/** Separa saber o conteúdo de conseguir converter esse conhecimento em prova. */
export function knowledgeExecutionSplit(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
): KnowledgeExecutionSplit {
  const rows = officialRowsOf(db, providerId).filter((row) => row.correct);
  if (!rows.length) {
    return {
      actualAccuracy: 0,
      knowledgeScore: 0,
      executionScore: 0,
      total: 0,
      knowledgeSample: 0,
      executionErrors: 0,
      slowRows: 0,
      diagnosis: "calibrando",
    };
  }

  const executionErrors = rows.filter((row) => {
    if (row.isCorrect !== false) return false;
    const note = rowNote(db, row);
    return note.knew === "pressa" || isExecutionReason(note.reason);
  }).length;
  const knowledgeRows = rows.filter((row) => {
    if (row.isCorrect !== false) return true;
    const note = rowNote(db, row);
    return !(note.knew === "pressa" || isExecutionReason(note.reason));
  });
  const slowRows = rows.filter((row) => row.timeSec > 240).length;
  const actualAccuracy = pct(rows.filter((row) => row.isCorrect).length, rows.length);
  const knowledgeScore = knowledgeRows.length
    ? pct(knowledgeRows.filter((row) => row.isCorrect).length, knowledgeRows.length)
    : actualAccuracy;
  const executionPenalty = (executionErrors / rows.length) * 100 + (slowRows / rows.length) * 18;
  const executionScore = Math.round(clamp(100 - executionPenalty));
  const gap = knowledgeScore - actualAccuracy;
  const diagnosis: KnowledgeExecutionSplit["diagnosis"] =
    rows.length < 6
      ? "calibrando"
      : gap >= 12 || executionScore < 65
        ? "execucao"
        : knowledgeScore < 65
          ? "conhecimento"
          : gap >= 6
            ? "misto"
            : "conhecimento";

  return {
    actualAccuracy,
    knowledgeScore,
    executionScore,
    total: rows.length,
    knowledgeSample: knowledgeRows.length,
    executionErrors,
    slowRows,
    diagnosis,
  };
}

function bucketForHour(hour: number): TemporalBucket["id"] {
  if (hour < 6) return "madrugada";
  if (hour < 12) return "manha";
  if (hour < 18) return "tarde";
  return "noite";
}

const BUCKET_LABELS: Record<TemporalBucket["id"], string> = {
  madrugada: "Madrugada",
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
};

/** Perfil de horário e queda por duração; só conclui algo com amostra mínima. */
export function temporalProfile(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
): TemporalProfile {
  const buckets = new Map<TemporalBucket["id"], { correct: number; total: number }>();
  for (const id of Object.keys(BUCKET_LABELS) as TemporalBucket["id"][]) buckets.set(id, { correct: 0, total: 0 });

  const attempts = db.attempts.filter((attempt) => attempt.result && sameProvider(attempt.providerId, providerId));
  let fatiguedAttempts = 0;
  const fatigueMoments: number[] = [];

  for (const attempt of attempts) {
    const rows = attempt.result?.rows.filter((row) => row.correct) ?? [];
    const hour = new Date(attempt.startedAt).getHours();
    const bucket = buckets.get(bucketForHour(hour))!;
    bucket.correct += rows.filter((row) => row.isCorrect).length;
    bucket.total += rows.length;

    if (rows.length >= 9) {
      const cut = Math.ceil(rows.length / 3);
      const first = rows.slice(0, cut);
      const last = rows.slice(-cut);
      const firstP = pct(first.filter((row) => row.isCorrect).length, first.length);
      const lastP = pct(last.filter((row) => row.isCorrect).length, last.length);
      if (firstP - lastP >= 15) {
        fatiguedAttempts++;
        const elapsedMin = Math.max(1, (attempt.elapsed || rows.reduce((sum, row) => sum + row.timeSec, 0)) / 60);
        fatigueMoments.push(Math.round(elapsedMin * (2 / 3)));
      }
    }
  }

  const temporalBuckets: TemporalBucket[] = [...buckets.entries()].map(([id, value]) => ({
    id,
    label: BUCKET_LABELS[id],
    correct: value.correct,
    total: value.total,
    accuracy: value.total ? pct(value.correct, value.total) : null,
  }));
  const eligible = temporalBuckets.filter((bucket) => bucket.total >= 5 && bucket.accuracy !== null);
  const bestBucket = eligible.sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0) || b.total - a.total)[0] ?? null;
  const fatigueThresholdMinutes = fatigueMoments.length
    ? [...fatigueMoments].sort((a, b) => a - b)[Math.floor(fatigueMoments.length / 2)]
    : null;

  return {
    buckets: temporalBuckets,
    bestBucket,
    fatigueThresholdMinutes,
    fatiguedAttempts,
    analyzedAttempts: attempts.length,
  };
}

function retentionScore(db: DB, providerId: string): number {
  const entries = Object.values(db.srs).filter((entry) => sameProvider(entry.providerId, providerId));
  if (!entries.length) return 50;
  const answered = entries.filter((entry) => entry.lastResult);
  if (!answered.length) return 50;
  return pct(answered.filter((entry) => entry.lastResult === "correct").length, answered.length);
}

/**
 * Índice próprio de prontidão. Não tenta prever nota, TRI ou aprovação.
 * O score resume sinais observáveis e carrega uma confiança separada.
 */
export function readinessSnapshot(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
  expectedContents?: string[],
): ReadinessSnapshot {
  const split = knowledgeExecutionSplit(db, providerId);
  const coverage = coverageSnapshot(db, providerId, expectedContents);
  const evidence = contentEvidence(db, providerId);
  const evidenceScore = evidence.length
    ? Math.round(evidence.reduce((sum, item) => sum + item.evidenceScore, 0) / evidence.length)
    : 0;
  const coverageScore = coverage.calibratedPct ?? Math.min(70, evidence.filter((item) => item.total >= MIN_ACTIONABLE_EVIDENCE).length * 8);
  const retention = retentionScore(db, providerId);
  const score = Math.round(
    split.knowledgeScore * 0.35 +
      retention * 0.2 +
      coverageScore * 0.2 +
      split.executionScore * 0.15 +
      evidenceScore * 0.1,
  );
  const sample = split.total;
  const confidence: EvidenceLevel = sample >= 60 && coverage.expected !== null
    ? "alta"
    : sample >= 20
      ? "media"
      : "baixa";
  const label: ReadinessSnapshot["label"] = score >= 82 ? "forte" : score >= 68 ? "consistente" : score >= 45 ? "em construcao" : "inicial";
  const risks: string[] = [];
  if (coverage.calibratedPct !== null && coverage.calibratedPct < 60) risks.push(`Cobertura calibrada ainda está em ${coverage.calibratedPct}%.`);
  if (split.knowledgeScore < 65) risks.push(`Domínio observado está em ${split.knowledgeScore}%.`);
  if (split.executionScore < 70) risks.push(`Execução em prova está em ${split.executionScore}/100.`);
  if (retention < 65) risks.push(`Retenção observada está em ${retention}%.`);
  if (confidence === "baixa") risks.push("Ainda há pouca evidência para uma leitura estável.");

  return {
    score: clamp(score),
    confidence,
    label,
    components: {
      knowledge: split.knowledgeScore,
      retention,
      coverage: coverageScore,
      execution: split.executionScore,
      evidence: evidenceScore,
    },
    sample,
    note: "Índice de prontidão do Studium; não é nota prevista, TRI nem probabilidade de aprovação.",
    risks,
  };
}

/** Explica o que mudaria a prioridade, em vez de só explicar por que ela existe. */
export function counterfactualForContent(evidence: ContentEvidence | null): string[] {
  if (!evidence) return ["Resolva ao menos 4 questões deste conteúdo para sair de 'não testado'."];
  const { correct, total, accuracy } = evidence;
  if (total < MIN_ACTIONABLE_EVIDENCE) {
    return [`Mais ${MIN_ACTIONABLE_EVIDENCE - total} resposta(s) levam o conteúdo à amostra mínima de decisão.`];
  }
  const out: string[] = [];
  if (accuracy < 65) {
    const needed = Math.max(1, Math.ceil((0.65 * total - correct) / 0.35));
    out.push(`${needed} acerto(s) consecutivo(s) levariam a taxa observada para pelo menos 65%.`);
  } else {
    const failures = Math.max(1, Math.floor(correct / 0.65 - total) + 1);
    out.push(`${failures} erro(s) consecutivo(s) derrubariam a taxa observada abaixo de 65%.`);
  }
  if (evidence.confidence !== "alta") {
    out.push("Mais amostra estreita o intervalo de confiança e pode mudar a prioridade sem alterar a taxa bruta.");
  }
  return out;
}
