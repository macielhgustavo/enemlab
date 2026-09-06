// Serviços de criação e correção de tentativas (portados do v6).
import { uid } from "../format";
import { ESSAY_THEMES } from "../domain/constants";
import { classifyContent, discipline, questionKey, finalTagRules } from "../domain/classify";
import {
  fetchExam,
  sample,
  dedupeByIndex,
  buildRealDay,
  buildUnseenAcrossYears,
} from "../api/enem";
import { buildAdaptiveQuestions } from "../domain/adaptive";
import { isQuestionUsableForPractice } from "../domain/question-quality";
import { ENEM_PROVIDER_ID, ITA_PROVIDER_ID, resolveProviderId, sameProvider } from "../providers";
import { itaQuestionsForAttempt, buildItaReviewAttempt } from "./ita-attempts";
import { officialRows, questionDifficultyFromRow, rebuildSessions } from "../domain/stats";
import { updateSRS } from "../domain/srs";
import type {
  Attempt,
  AttemptMode,
  AreaId,
  DB,
  Language,
  Question,
  ResultRow,
} from "../domain/types";

export interface NewTrainingParams {
  year: number;
  lang: Language;
  mode: AttemptMode;
  area: AreaId | "all";
  minutes: number;
  strict: boolean;
  strategy: boolean;
  alerts: boolean;
}

function baseAttempt(partial: Partial<Attempt> & Pick<Attempt, "year" | "lang" | "mode">): Attempt {
  return {
    id: uid(),
    // Toda tentativa nasce carimbada com a prova de origem.
    providerId: ENEM_PROVIDER_ID,
    area: "all",
    minutes: 50,
    strict: false,
    strategy: false,
    alerts: true,
    pass: 1,
    passByQuestion: {},
    realDay: null,
    questionRefs: [],
    answers: {},
    confidence: {},
    flags: {},
    timeQ: {},
    elapsed: 0,
    questionSec: 0,
    essaySec: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    essay: null,
    ...partial,
  };
}

function refsFrom(qs: Question[], fallbackYear: number, providerId = ENEM_PROVIDER_ID) {
  return qs.map((q) => ({
    providerId,
    index: q.index,
    year: q.year || fallbackYear,
    language: q.language || null,
    discipline: discipline(q),
  }));
}

// Constrói uma tentativa a partir de uma lista de questões prontas.
export function attemptFromQuestions(
  year: number,
  lang: Language,
  qs: Question[],
  mode: AttemptMode,
): Attempt {
  return baseAttempt({
    year,
    lang,
    mode,
    minutes: Math.max(30, Math.round(qs.length * 3.2)),
    questionRefs: refsFrom(qs, year),
  });
}

// Monta a tentativa do formulário "Novo treino" (todos os modos do v6).
export async function buildTrainingAttempt(db: DB, p: NewTrainingParams): Promise<Attempt> {
  const { year, lang, mode, area } = p;
  const seen = new Set(officialRows(db).map((x) => x.key));

  if (mode === "unseen90") {
    const qs = await buildUnseenAcrossYears(lang, seen, 90);
    if (qs.length < 45)
      throw new Error(`Só encontrei ${qs.length} questões inéditas com os filtros atuais.`);
    return attemptFromQuestions(qs[0].year, lang, qs, "unseen90");
  }

  const all = await fetchExam(year, lang);
  const practiceAll = all.filter(isQuestionUsableForPractice);

  if (mode === "unseen15" || mode === "unseen30") {
    const n = mode === "unseen15" ? 15 : 30;
    const pool = practiceAll.filter(
      (q) => (area === "all" || discipline(q) === area) && !seen.has(questionKey(q)),
    );
    const qs = sample(pool, n);
    if (!qs.length) throw new Error("Você já viu todas as questões utilizáveis desse filtro.");
    return attemptFromQuestions(year, lang, qs, mode);
  }

  if (mode === "adaptive15") {
    const qs = buildAdaptiveQuestions(db, practiceAll, 15);
    if (!qs.length) throw new Error("Não encontrei questões válidas para o treino adaptativo.");
    return attemptFromQuestions(year, lang, qs, "adaptive15");
  }

  if (mode === "real1" || mode === "real2") {
    if (year < 2014)
      throw new Error("Use 2014–2023 para o ENEM Real (estrutura comparável ao formato atual).");
    const day = mode === "real1" ? 1 : 2;
    // Provas reais preservam a estrutura oficial. Questões suspeitas são avisadas no runner,
    // não removidas silenciosamente.
    const pool = buildRealDay(all, day, lang);
    return baseAttempt({
      year,
      lang,
      mode,
      minutes: day === 1 ? 330 : 300,
      strict: p.strict,
      strategy: p.strategy,
      alerts: p.alerts,
      realDay: day,
      questionRefs: refsFrom(pool, year),
      essay: day === 1 ? { theme: ESSAY_THEMES[year] || "", text: "", versions: [] } : null,
    });
  }

  let pool: Question[];
  if (mode === "full") {
    // "full" também mantém a estrutura do ano; a auditoria fica visível durante a prova.
    pool = dedupeByIndex(all, lang).slice(0, 180);
  } else {
    pool =
      area === "all"
        ? dedupeByIndex(practiceAll, lang)
        : practiceAll.filter((q) => discipline(q) === area);
    if (area !== "all" && pool.length > 45) pool = pool.slice(0, 45);
    if (mode === "sprint15") pool = sample(pool, 15);
    else if (mode === "sprint30") pool = sample(pool, 30);
    else pool.sort((a, b) => a.index - b.index);
  }
  if (!pool.length) throw new Error("Nenhuma questão válida para este filtro.");

  return baseAttempt({
    year,
    lang,
    mode,
    area,
    minutes: p.minutes,
    strict: p.strict,
    strategy: p.strategy,
    alerts: p.alerts,
    questionRefs: refsFrom(pool, year),
  });
}

// Gera uma fila Adaptive (15/30) a partir do estado atual.
export async function buildAdaptiveAttempt(
  db: DB,
  n = 15,
  year = 2023,
  lang: Language = "ingles",
): Promise<Attempt> {
  const all = (await fetchExam(year, lang)).filter(isQuestionUsableForPractice);
  const qs = buildAdaptiveQuestions(db, all, n);
  if (!qs.length) throw new Error("Não encontrei questões válidas para o treino adaptativo.");
  return attemptFromQuestions(year, lang, qs, "adaptive");
}

// Bloco de revisões SRS vencidas.
export async function buildDueReviewsAttempt(
  db: DB,
  limit = 30,
  providerId: string = ENEM_PROVIDER_ID,
): Promise<Attempt> {
  const due = Object.entries(db.srs)
    .filter(([, v]) => sameProvider(v.providerId, providerId))
    .filter(([, v]) => new Date(v.due).getTime() <= Date.now())
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => +new Date(a.due) - +new Date(b.due))
    .slice(0, limit);
  if (!due.length) throw new Error("Nenhuma revisão vencida.");

  // Prova em modo referência monta a fila do próprio gabarito.
  if (resolveProviderId(providerId) === ITA_PROVIDER_ID) {
    return buildItaReviewAttempt(due);
  }
  const groups: Record<string, typeof due> = {};
  due.forEach((x) => {
    const k = `${x.year}|${x.language || "ingles"}`;
    (groups[k] ??= []).push(x);
  });
  const first = Object.values(groups)[0];
  const year = first[0].year;
  const lang = (first[0].language || "ingles") as Language;
  const all = await fetchExam(year, lang);
  const qs: Question[] = [];
  for (const x of first) {
    const q =
      all.find((q) => q.index === x.index && discipline(q) === x.area) ||
      all.find((q) => q.index === x.index);
    if (q) qs.push(q);
  }
  return attemptFromQuestions(year, lang, qs, "srs");
}

// Sprint focado de tamanho variável para o plano diário e treino manual.
export async function buildContentSprintAttempt(content: string, n = 15): Promise<Attempt> {
  const all = (await fetchExam(2023, "ingles")).filter(isQuestionUsableForPractice);
  const qs = sample(all.filter((q) => classifyContent(q) === content), Math.max(1, n));
  if (!qs.length) throw new Error("Não encontrei questões válidas desse conteúdo em 2023.");
  return attemptFromQuestions(2023, "ingles", qs, "content");
}

// Refazer um conjunto de linhas erradas.
export function buildRetryAttempt(src: Attempt, rows: ResultRow[]): Attempt {
  return baseAttempt({
    providerId: resolveProviderId(src.providerId),
    year: src.year,
    lang: src.lang,
    mode: "retry",
    minutes: Math.max(20, Math.round(rows.length * 3)),
    retryOf: src.id,
    questionRefs: rows.map((x) => ({
      index: x.index,
      year: x.year || src.year,
      language: x.language,
      discipline: x.area,
    })),
  });
}

// Recuperação ativa: uma única questão do SRS, revelada só após tentar lembrar.
export async function buildActiveRecallAttempt(db: DB, key: string): Promise<Attempt> {
  const x = db.srs[key];
  if (!x) throw new Error("Item de revisão não encontrado.");
  if (resolveProviderId(x.providerId) === ITA_PROVIDER_ID) {
    return buildItaReviewAttempt([{ key, ...x }], true);
  }
  const lang = (x.language || "ingles") as Language;
  const all = await fetchExam(x.year, lang);
  const q =
    all.find((qq) => qq.index === x.index && discipline(qq) === x.area) ||
    all.find((qq) => qq.index === x.index);
  if (!q) throw new Error("Questão não encontrada.");
  return baseAttempt({
    year: x.year,
    lang,
    mode: "srs-recall",
    minutes: 10,
    activeRecall: true,
    questionRefs: refsFrom([q], x.year),
  });
}

// Recupera as questões de uma tentativa (agrupando por ano) — usar dentro de React Query.
export async function questionsForAttempt(a: Attempt): Promise<Question[]> {
  // Provas em modo referência (ITA) montam as questões a partir do gabarito
  // oficial: não há banco remoto para consultar.
  if (resolveProviderId(a.providerId) === ITA_PROVIDER_ID) {
    return itaQuestionsForAttempt(a);
  }

  const groups: Record<number, Attempt["questionRefs"]> = {};
  for (const r of a.questionRefs) {
    const y = r.year || a.year;
    (groups[y] ??= []).push(r);
  }
  const out: Question[] = [];
  for (const [y, refs] of Object.entries(groups)) {
    const all = await fetchExam(Number(y), a.lang);
    for (const r of refs) {
      const q =
        all.find(
          (x) =>
            x.index === r.index &&
            (r.language ? x.language === r.language : true) &&
            discipline(x) === r.discipline,
        ) ||
        all.find((x) => x.index === r.index && discipline(x) === r.discipline) ||
        all.find((x) => x.index === r.index);
      if (q) out.push(q);
    }
  }
  return out;
}

// Correção: computa rows + result, aplica SRS/tags/dificuldade e reconstrói sessões.
// Muta `db` (chamar dentro de store.mutate).
export function finishAttemptInDB(db: DB, attemptId: string, questions: Question[]): void {
  const a = db.attempts.find((x) => x.id === attemptId);
  if (!a || !questions.length) return;

  a.finishedAt = new Date().toISOString();

  const rows: ResultRow[] = questions.map((q) => {
    const k = questionKey(q);
    const corr =
      q.correctAlternative || q.alternatives?.find((x) => x.isCorrect)?.letter || null;
    const sel = a.answers[k] || null;
    const tags = finalTagRules(q);
    return {
      key: k,
      // Cada linha corrigida carrega a prova: é o que permite não misturar
      // estatística entre bancas depois.
      providerId: resolveProviderId(a.providerId),
      index: q.index,
      year: q.year,
      area: discipline(q),
      language: q.language || null,
      content: tags[0] || classifyContent(q),
      tags,
      selected: sel,
      correct: corr,
      isCorrect: corr ? sel === corr : null,
      confidence: a.confidence[k] || null,
      timeSec: Math.round(a.timeQ[k] || 0),
      flagged: !!a.flags[k],
      finishedAt: a.finishedAt,
      pass: a.passByQuestion?.[k] || 1,
    };
  });

  const valid = rows.filter((r) => r.correct);
  a.result = {
    rows,
    correct: valid.filter((r) => r.isCorrect).length,
    total: valid.length,
    blank: rows.filter((r) => !r.selected).length,
  };
  for (const r of rows) r.difficulty = questionDifficultyFromRow(db, r);
  rows.forEach((r) => updateSRS(db, r, a));
  rebuildSessions(db);
}
