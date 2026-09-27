import { buildRealDay } from "../api/enem";
import { buildCurrentCatalog } from "../catalog/current";
import type { CatalogEntry } from "../catalog";
import { ESSAY_THEMES } from "../domain/constants";
import type { Attempt, Language, Question } from "../domain/types";
import { questionsFor } from "../providers/access";
import { ENEM_PROVIDER_ID, getProvider, resolveProviderId } from "../providers";
import { attemptFromQuestions } from "./attempts";

export type SimulationTimingBasis = "configured" | "internal-estimate";

export interface SimulationTiming {
  minutes: number | null;
  basis: SimulationTimingBasis;
}

const CONFIGURED_MINUTES: Record<string, number> = {
  "enem:day1": 330,
  "enem:day2": 300,
  "ita:first": 240,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function simulationEntryKey(entry: Pick<CatalogEntry, "editionId" | "phase">): string {
  return `${entry.editionId}::${entry.phase}`;
}

export function simulationEntriesForProvider(providerId: string): CatalogEntry[] {
  const scoped = resolveProviderId(providerId);
  const phases = getProvider(scoped).metadata.phases;
  const phaseOrder = new Map<string, number>(
    phases.map((phase, index) => [phase, index]),
  );

  return buildCurrentCatalog()
    .query({ providerId: scoped })
    .filter((entry) => entry.questionCount !== 0)
    .sort(
      (a, b) =>
        b.year - a.year ||
        b.editionId.localeCompare(a.editionId, "pt-BR", { numeric: true }) ||
        (phaseOrder.get(a.phase) ?? 99) - (phaseOrder.get(b.phase) ?? 99),
    );
}

export function simulationTiming(
  entry: Pick<CatalogEntry, "providerId" | "phase" | "questionCount">,
  loadedQuestionCount = entry.questionCount ?? 0,
): SimulationTiming {
  const configured = CONFIGURED_MINUTES[`${resolveProviderId(entry.providerId)}:${entry.phase}`];
  if (configured) return { minutes: configured, basis: "configured" };
  if (loadedQuestionCount <= 0) return { minutes: null, basis: "internal-estimate" };
  return {
    minutes: clamp(Math.round(loadedQuestionCount * 3), 30, 360),
    basis: "internal-estimate",
  };
}

function providerLanguage(providerId: string, requested?: string | null): Language {
  const metadata = getProvider(providerId).metadata;
  const valid = metadata.languages.some((language) => language.id === requested);
  const selected = valid ? requested : metadata.languages[0]?.id;
  return (selected === "espanhol" ? "espanhol" : "ingles") as Language;
}

function exactBlock(
  entry: CatalogEntry,
  questions: Question[],
  language: Language,
): Question[] {
  const providerId = resolveProviderId(entry.providerId);

  if (providerId === ENEM_PROVIDER_ID) {
    if (entry.phase === "day1" || entry.phase === "day2") {
      return buildRealDay(questions, entry.phase === "day1" ? 1 : 2, language);
    }
    return [];
  }

  const samePhase = questions.filter((question) => question.phase === entry.phase);
  if (samePhase.length) return samePhase;

  const phases = getProvider(providerId).metadata.phases;
  if (entry.phase === "single" || phases.length === 1) return questions;
  return [];
}

export async function buildSimulationAttempt(
  entry: CatalogEntry,
  requestedLanguage?: string | null,
): Promise<Attempt> {
  const providerId = resolveProviderId(entry.providerId);
  const lang = providerLanguage(providerId, requestedLanguage);
  const loaded = await questionsFor(providerId, {
    year: entry.year,
    editionId: entry.editionId,
    language: lang,
  });
  const questions = exactBlock(entry, loaded, lang).sort((a, b) => a.index - b.index);

  if (!questions.length) {
    throw new Error("Este bloco não está disponível para simulado no runner atual.");
  }
  if (entry.questionCount !== null && questions.length !== entry.questionCount) {
    throw new Error(
      `O catálogo espera ${entry.questionCount} questões neste bloco, mas ${questions.length} foram carregadas. O simulado foi bloqueado para não medir uma prova incompleta.`,
    );
  }

  const timing = simulationTiming(entry, questions.length);
  if (!timing.minutes) throw new Error("Não foi possível definir a duração deste simulado.");

  const attempt = attemptFromQuestions(entry.year, lang, questions, "simulado", providerId);
  return {
    ...attempt,
    minutes: timing.minutes,
    strict: true,
    strategy: false,
    alerts: false,
    simulation: {
      editionId: entry.editionId,
      phase: entry.phase,
      questionCount: questions.length,
      statementAvailable: entry.statementAvailable,
      timingBasis: timing.basis,
    },
    essay:
      providerId === ENEM_PROVIDER_ID && entry.phase === "day1"
        ? { theme: ESSAY_THEMES[entry.year] || "", text: "", versions: [] }
        : null,
  };
}
