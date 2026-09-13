import { buildAdaptiveQuestions } from "../domain/adaptive";
import { classifyContent, discipline, questionKey } from "../domain/classify";
import { officialRowsOf } from "../domain/stats";
import type { DB, Language, Question } from "../domain/types";
import { questionsFor } from "../providers/access";
import { getProvider, resolveProviderId } from "../providers";
import { attemptFromQuestions } from "./attempts";

interface ProviderPool {
  providerId: string;
  year: number;
  editionId?: string;
  lang: Language;
  questions: Question[];
}

function recentEditions(providerId: string, limit = 3) {
  const provider = getProvider(providerId);
  const explicit = provider.metadata.editions;
  if (explicit?.length) return explicit.slice(0, limit);
  return provider.metadata.years.slice(0, limit).map((year) => ({
    id: String(year),
    label: `${provider.metadata.shortLabel} ${year}`,
    year,
  }));
}

async function latestProviderPool(providerId: string): Promise<ProviderPool> {
  const scopedProviderId = resolveProviderId(providerId);
  const provider = getProvider(scopedProviderId);
  const edition = recentEditions(scopedProviderId, 1)[0];
  const year = edition?.year ?? provider.metadata.years[0];
  if (!year) throw new Error("Nenhuma edição disponível para esta prova.");

  const lang = (provider.metadata.languages[0]?.id ?? "ingles") as Language;
  const questions = await questionsFor(scopedProviderId, {
    year,
    editionId: edition?.id,
    language: lang,
  });
  if (!questions.length) throw new Error("Nenhuma questão disponível para esta prova.");

  return {
    providerId: scopedProviderId,
    year,
    editionId: edition?.id,
    lang,
    questions,
  };
}

async function adaptiveProviderPool(providerId: string): Promise<ProviderPool> {
  const scopedProviderId = resolveProviderId(providerId);
  const provider = getProvider(scopedProviderId);
  const editions = recentEditions(scopedProviderId, 3);
  const lang = (provider.metadata.languages[0]?.id ?? "ingles") as Language;
  const questions: Question[] = [];

  for (const edition of editions) {
    const batch = await questionsFor(scopedProviderId, {
      year: edition.year,
      editionId: edition.id,
      language: lang,
    });
    questions.push(...batch);
  }

  if (!questions.length) throw new Error("Nenhuma questão disponível para esta prova.");
  return {
    providerId: scopedProviderId,
    year: questions[0]?.year ?? editions[0]?.year,
    editionId: editions[0]?.id,
    lang,
    questions,
  };
}

function contentOf(question: Question): string {
  return question.statementAvailable === false
    ? String(discipline(question))
    : classifyContent(question);
}

export async function buildProviderAdaptiveAttempt(
  db: DB,
  providerId: string,
  n = 15,
) {
  const pool = await adaptiveProviderPool(providerId);
  const questions = buildAdaptiveQuestions(db, pool.questions, n, pool.providerId);
  if (!questions.length) throw new Error("Não encontrei questões para o treino adaptativo.");
  return attemptFromQuestions(pool.year, pool.lang, questions, "adaptive", pool.providerId);
}

export async function buildProviderContentAttempt(
  providerId: string,
  content: string,
  n = 15,
) {
  const pool = await latestProviderPool(providerId);
  const matching = pool.questions
    .filter((question) => contentOf(question) === content)
    .sort((a, b) => questionKey(a).localeCompare(questionKey(b)))
    .slice(0, Math.max(1, n));
  if (!matching.length) {
    throw new Error("Não encontrei questões desta matéria/conteúdo na edição disponível.");
  }
  return attemptFromQuestions(pool.year, pool.lang, matching, "content", pool.providerId);
}

export async function buildProviderUnseenAttempt(
  db: DB,
  providerId: string,
  n = 15,
) {
  const pool = await latestProviderPool(providerId);
  const seen = new Set(officialRowsOf(db, pool.providerId).map((row) => row.key));
  const questions = pool.questions
    .filter((question) => !seen.has(questionKey(question)))
    .sort((a, b) => questionKey(a).localeCompare(questionKey(b)))
    .slice(0, Math.max(1, n));
  if (!questions.length) throw new Error("Você já viu todas as questões desta edição.");
  return attemptFromQuestions(pool.year, pool.lang, questions, "unseen15", pool.providerId);
}
