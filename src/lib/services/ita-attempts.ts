// Tentativas do ITA (modo referência).
//
// As provas oficiais são digitalizadas, então o enunciado não é reproduzido:
// o app entrega numeração, matéria, gabarito e o link do documento oficial.
// O aluno lê a questão no PDF e marca a alternativa aqui.
import {
  ITA_PROVIDER_ID,
  itaAnswerKey,
  itaFirstPhaseQuestions,
  itaFirstPhaseUrl,
  itaYears,
} from "../providers";
import { buildAdaptiveQuestions } from "../domain/adaptive";
import type { Attempt, DB, Question } from "../domain/types";

/** Converte a questão normalizada do ITA para o formato que o runner consome. */
function toQuestion(n: ReturnType<typeof itaFirstPhaseQuestions>[number]): Question {
  return {
    index: n.index,
    number: n.number,
    year: n.year,
    language: n.language,
    // O id da matéria do ITA ("physics") é propositalmente distinto das áreas
    // do ENEM ("ciencias-natureza"): impede que as duas provas se somem.
    discipline: n.subject.id,
    alternatives: n.alternatives.map((a) => ({
      letter: a.letter,
      text: "",
      file: null,
      isCorrect: a.isCorrect,
    })),
    correctAlternative: n.correctAlternative ?? undefined,
    files: [],
    statementAvailable: false,
    official: n.official,
  };
}

/** Questões de uma tentativa do ITA, reconstruídas a partir do gabarito. */
export function itaQuestionsForAttempt(a: Attempt): Question[] {
  const porAno = new Map<number, Question[]>();
  const out: Question[] = [];

  for (const ref of a.questionRefs) {
    const year = ref.year || a.year;
    if (!porAno.has(year)) {
      porAno.set(year, itaFirstPhaseQuestions(year).map(toQuestion));
    }
    const found = porAno.get(year)!.find((q) => q.index === ref.index);
    if (found) out.push(found);
  }
  return out;
}

export interface ItaAttemptOptions {
  /** Restringe a uma matéria (ex.: só Física). Vazio = prova inteira. */
  subject?: string | null;
  minutes?: number;
}

/**
 * Monta a 1ª fase do ITA de um ano. Lança quando a edição não foi ingerida,
 * em vez de devolver uma prova vazia.
 */
export function buildItaFirstPhaseAttempt(
  year: number,
  { subject, minutes }: ItaAttemptOptions = {},
): Attempt {
  const key = itaAnswerKey(year);
  if (!key) {
    throw new Error(
      `Não tenho o gabarito oficial do ITA ${year}. Edições disponíveis vêm de 2019 em diante.`,
    );
  }

  let questions = itaFirstPhaseQuestions(year);
  if (subject) {
    questions = questions.filter((q) => q.subject.id === subject);
    if (!questions.length) throw new Error(`Sem questões de ${subject} no ITA ${year}.`);
  }

  return {
    id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    providerId: ITA_PROVIDER_ID,
    year,
    lang: "ingles",
    mode: "full",
    area: "all",
    // 4 horas para a prova completa; proporcional quando é uma matéria só.
    minutes: minutes ?? Math.max(30, Math.round((questions.length / key.total) * 240)),
    strict: false,
    strategy: false,
    alerts: true,
    pass: 1,
    passByQuestion: {},
    realDay: null,
    questionRefs: questions.map((q) => ({
      providerId: ITA_PROVIDER_ID,
      index: q.index,
      year: q.year,
      language: q.language,
      discipline: q.subject.id,
    })),
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
  } as Attempt;
}

/** Link do documento oficial usado por uma tentativa do ITA. */
export function itaAttemptSourceUrl(a: Attempt): string {
  return itaFirstPhaseUrl(a.year);
}

/**
 * Fila adaptativa do ITA: junta as objetivas de todas as edições ingeridas e
 * deixa o motor ranquear pelo histórico do próprio ITA. Sem TRI e sem
 * discursivas — só 1ª fase.
 */
export function buildItaAdaptiveAttempt(db: DB, n = 15): Attempt {
  const anos = itaYears();
  if (!anos.length) throw new Error("Nenhuma edição do ITA disponível.");

  const pool: Question[] = [];
  for (const year of anos) {
    pool.push(...itaFirstPhaseQuestions(year).map(toQuestion));
  }

  const escolhidas = buildAdaptiveQuestions(db, pool, n, ITA_PROVIDER_ID);
  if (!escolhidas.length) throw new Error("Não encontrei questões do ITA para o adaptativo.");

  // Uma fila adaptativa pode cruzar anos: cada ref carrega o seu.
  const base = buildItaFirstPhaseAttempt(escolhidas[0].year, { minutes: Math.max(30, n * 5) });
  return {
    ...base,
    mode: "adaptive",
    questionRefs: escolhidas.map((q) => ({
      providerId: ITA_PROVIDER_ID,
      index: q.index,
      year: q.year,
      language: q.language ?? null,
      discipline: String(q.discipline),
    })),
  };
}
