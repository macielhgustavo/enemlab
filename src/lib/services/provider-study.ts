import { buildAdaptiveQuestions, adaptiveCandidates } from "../domain/adaptive";
import { classifyContent, questionKey } from "../domain/classify";
import { officialRowsOf } from "../domain/stats";
import { dueSRS } from "../domain/srs";
import { actionableWeakContents, calibrationContents } from "../domain/weak-evidence";
import type { Attempt, DB, Language, Question } from "../domain/types";
import { questionsFor } from "../providers/access";
import { getProvider, resolveProviderId } from "../providers";
import { attemptFromQuestions } from "./attempts";

interface ProviderEditionRef {
  id?: string;
  year: number;
}

interface ProviderPool {
  providerId: string;
  year: number;
  lang: Language;
  questions: Question[];
}

export type StudyActionKind = "review" | "weakness" | "retry" | "unseen" | "adaptive";

export interface StudyAction {
  kind: StudyActionKind;
  providerId: string;
  title: string;
  reason: string;
  content?: string;
  count: number;
}

function providerLanguage(providerId: string): Language {
  const language = getProvider(providerId).metadata.languages[0]?.id;
  return (language === "espanhol" ? "espanhol" : "ingles") as Language;
}

function orderedEditions(providerId: string): ProviderEditionRef[] {
  const provider = getProvider(providerId);
  const explicit = provider.metadata.editions;
  if (explicit?.length) {
    return explicit
      .map((edition, index) => ({ ...edition, index }))
      .sort((a, b) => b.year - a.year || a.index - b.index)
      .map(({ id, year }) => ({ id, year }));
  }
  return provider.metadata.years.map((year) => ({ year }));
}

async function loadProviderPool(providerId: string, editionLimit = 3): Promise<ProviderPool> {
  const scopedProviderId = resolveProviderId(providerId);
  const lang = providerLanguage(scopedProviderId);
  const editions = orderedEditions(scopedProviderId).slice(0, Math.max(1, editionLimit));
  if (!editions.length) throw new Error("Nenhuma edição disponível para esta prova.");

  const byKey = new Map<string, Question>();
  for (const edition of editions) {
    const batch = await questionsFor(scopedProviderId, {
      year: edition.year,
      editionId: edition.id,
      language: lang,
    });
    for (const question of batch) byKey.set(questionKey(question), question);
  }

  const questions = [...byKey.values()];
  if (!questions.length) throw new Error("Nenhuma questão disponível para esta prova.");
  return {
    providerId: scopedProviderId,
    year: questions[0]?.year ?? editions[0].year,
    lang,
    questions,
  };
}

interface StoredQuestionIdentity {
  key: string;
  year: number;
  index: number;
  language?: string | null;
}

/**
 * Resolve linhas persistidas pela chave oficial, inclusive quando existem
 * várias edições no mesmo ano. Não cai para "questão de mesmo índice" entre
 * edições diferentes: se a identidade não casar, falha fechado.
 */
async function resolveStoredQuestions(
  providerId: string,
  items: StoredQuestionIdentity[],
): Promise<Question[]> {
  const scopedProviderId = resolveProviderId(providerId);
  const provider = getProvider(scopedProviderId);
  const explicit = provider.metadata.editions ?? [];
  const cache = new Map<string, Promise<Question[]>>();
  const out: Question[] = [];

  for (const item of items) {
    const editions: ProviderEditionRef[] = explicit.length
      ? explicit.filter((edition) => edition.year === item.year).map(({ id, year }) => ({ id, year }))
      : [{ year: item.year }];
    const candidates = editions.length ? editions : [{ year: item.year }];
    const lang = (item.language === "espanhol" ? "espanhol" : providerLanguage(scopedProviderId)) as Language;
    let found: Question | undefined;

    for (const edition of candidates) {
      const cacheKey = `${edition.year}|${edition.id ?? ""}|${lang}`;
      let pending = cache.get(cacheKey);
      if (!pending) {
        pending = questionsFor(scopedProviderId, {
          year: edition.year,
          editionId: edition.id,
          language: lang,
        });
        cache.set(cacheKey, pending);
      }
      const batch = await pending;
      found = batch.find((question) => questionKey(question) === item.key);
      if (found) break;
    }

    if (found) out.push(found);
  }

  return out;
}

export function nextStudyAction(db: DB, providerId: string): StudyAction {
  const scopedProviderId = resolveProviderId(providerId);
  const due = dueSRS(db, scopedProviderId);
  if (due.length) {
    return {
      kind: "review",
      providerId: scopedProviderId,
      title: "Revisar antes de avançar",
      reason: `${due.length} revisão(ões) vencida(s) estão segurando a retenção.`,
      count: due.length,
    };
  }

  // Uma taxa baixa com 1–3 respostas é sinal para coletar evidência, não prova
  // de fraqueza. Só abrimos um bloco dedicado quando a amostra mínima usada
  // pelo próprio domínio do Studium também foi atingida.
  const weak = actionableWeakContents(db, 5, scopedProviderId)[0];
  if (weak) {
    return {
      kind: "weakness",
      providerId: scopedProviderId,
      title: `Reparar ${weak.name}`,
      reason: `Amostra mínima atingida: ${weak.p}% de acerto (${weak.c}/${weak.t}), IC95% ${weak.ci.low}–${weak.ci.high}%.`,
      content: weak.name,
      count: weak.t,
    };
  }

  const wrong = adaptiveCandidates(db, scopedProviderId);
  if (wrong.length) {
    return {
      kind: "retry",
      providerId: scopedProviderId,
      title: "Refazer erros prioritários",
      reason: `${wrong.length} erro(s) ainda têm sinal de recuperação ativa.`,
      count: wrong.length,
    };
  }

  const history = officialRowsOf(db, scopedProviderId);
  if (!history.length) {
    return {
      kind: "unseen",
      providerId: scopedProviderId,
      title: "Criar amostra inicial",
      reason: "Ainda não há histórico suficiente desta prova; comece por questões inéditas.",
      count: 0,
    };
  }

  const calibrating = calibrationContents(db, 5, scopedProviderId);
  return {
    kind: "adaptive",
    providerId: scopedProviderId,
    title: "Novo treino adaptativo",
    reason: calibrating.length
      ? `${calibrating.length} conteúdo(s) ainda têm amostra curta; o próximo treino coleta evidência sem rotulá-los como fraqueza.`
      : "Retenção, lacunas e erros prioritários estão sob controle; avance com nova amostra.",
    count: history.length,
  };
}

export async function buildProviderAdaptiveAttempt(
  db: DB,
  providerId: string,
  n = 15,
): Promise<Attempt> {
  const pool = await loadProviderPool(providerId, 3);
  const questions = buildAdaptiveQuestions(db, pool.questions, n, pool.providerId);
  if (!questions.length) throw new Error("Não encontrei questões para o treino adaptativo.");
  return attemptFromQuestions(pool.year, pool.lang, questions, "adaptive", pool.providerId);
}

export async function buildProviderContentAttempt(
  providerId: string,
  content: string,
  n = 15,
): Promise<Attempt> {
  const scopedProviderId = resolveProviderId(providerId);
  const maxEditions = Math.max(1, orderedEditions(scopedProviderId).length);
  let pool = await loadProviderPool(scopedProviderId, Math.min(5, maxEditions));
  let matching = pool.questions.filter((question) => classifyContent(question) === content);

  // Conteúdo fraco pode vir de edição mais antiga; amplia a busca só quando
  // necessário, evitando carregar o acervo inteiro no caminho comum.
  if (!matching.length && maxEditions > 5) {
    pool = await loadProviderPool(scopedProviderId, maxEditions);
    matching = pool.questions.filter((question) => classifyContent(question) === content);
  }

  const questions = matching
    .sort((a, b) => questionKey(a).localeCompare(questionKey(b)))
    .slice(0, Math.max(1, n));
  if (!questions.length) {
    throw new Error("Não encontrei questões deste conteúdo nas edições disponíveis.");
  }
  return attemptFromQuestions(questions[0].year, pool.lang, questions, "content", scopedProviderId);
}

export async function buildProviderUnseenAttempt(
  db: DB,
  providerId: string,
  n = 15,
): Promise<Attempt> {
  const pool = await loadProviderPool(providerId, 1);
  const seen = new Set(officialRowsOf(db, pool.providerId).map((row) => row.key));
  const questions = pool.questions
    .filter((question) => !seen.has(questionKey(question)))
    .sort((a, b) => questionKey(a).localeCompare(questionKey(b)))
    .slice(0, Math.max(1, n));
  if (!questions.length) throw new Error("Você já viu todas as questões da edição mais recente.");
  return attemptFromQuestions(pool.year, pool.lang, questions, "unseen15", pool.providerId);
}

async function buildProviderDueAttempt(
  db: DB,
  providerId: string,
  n: number,
): Promise<Attempt> {
  const scopedProviderId = resolveProviderId(providerId);
  const due = dueSRS(db, scopedProviderId).slice(0, Math.max(1, n));
  const questions = await resolveStoredQuestions(
    scopedProviderId,
    due.map((item) => ({
      key: item.key,
      year: item.year,
      index: item.index,
      language: item.language,
    })),
  );
  if (!questions.length) throw new Error("Não consegui resolver as revisões vencidas desta prova.");
  const lang = (questions[0].language === "espanhol" ? "espanhol" : "ingles") as Language;
  return attemptFromQuestions(questions[0].year, lang, questions, "srs", scopedProviderId);
}

async function buildProviderRetryAttempt(
  db: DB,
  providerId: string,
  n: number,
): Promise<Attempt> {
  const scopedProviderId = resolveProviderId(providerId);
  const candidates = adaptiveCandidates(db, scopedProviderId).slice(0, Math.max(1, n));
  const questions = await resolveStoredQuestions(scopedProviderId, candidates);
  if (!questions.length) throw new Error("Não consegui resolver os erros prioritários desta prova.");
  const lang = (questions[0].language === "espanhol" ? "espanhol" : "ingles") as Language;
  return attemptFromQuestions(questions[0].year, lang, questions, "retry", scopedProviderId);
}

/**
 * Executa o ciclo recomendado:
 * revisão vencida → reparar fraqueza → refazer erros → inéditas/adaptativo.
 */
export async function buildNextStudyAttempt(
  db: DB,
  providerId: string,
  n = 15,
): Promise<Attempt> {
  const action = nextStudyAction(db, providerId);
  if (action.kind === "review") return buildProviderDueAttempt(db, providerId, n);
  if (action.kind === "weakness") return buildProviderContentAttempt(providerId, action.content!, n);
  if (action.kind === "retry") return buildProviderRetryAttempt(db, providerId, n);
  if (action.kind === "unseen") return buildProviderUnseenAttempt(db, providerId, n);
  return buildProviderAdaptiveAttempt(db, providerId, n);
}
