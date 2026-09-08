import type { ExamMetadata, ExamProvider } from "../types";
import {
  buildFabProvider,
  fabQuestionsForKey,
  fabQuestionKey,
  fabVariants,
  normalizeFabAnswerKey,
  type FabAnswerKey,
  type FabAnswerKeyRaw,
} from "../fab";
import raw from "./answer-keys.generated.json";

export const EPCAR_PROVIDER_ID = "epcar";
const SUBJECT_LABELS = {
  english: "Língua Inglesa",
  mathematics: "Matemática",
  portuguese: "Língua Portuguesa",
};

const KEYS = Object.fromEntries(
  Object.entries(raw as unknown as Record<string, FabAnswerKeyRaw>).map(([year, value]) => [
    year,
    normalizeFabAnswerKey(value),
  ]),
) as Record<string, FabAnswerKey>;

export function epcarYears(): number[] {
  return Object.values(KEYS)
    .map((key) => key.year)
    .sort((a, b) => b - a);
}

export function epcarAnswerKey(year: number): FabAnswerKey | null {
  return KEYS[String(year)] ?? null;
}

export function epcarVariants(year: number) {
  const key = epcarAnswerKey(year);
  return key ? fabVariants(key) : null;
}

export function epcarQuestionKey(year: number, phase: string, number: number): string {
  return fabQuestionKey(EPCAR_PROVIDER_ID, year, phase, number);
}

export const epcarMetadata: ExamMetadata = {
  id: EPCAR_PROVIDER_ID,
  label: "Escola Preparatória de Cadetes do Ar",
  shortLabel: "EPCAR",
  years: epcarYears(),
  languages: [],
  phases: ["first"],
  hasEssay: false,
  areas: Object.entries(SUBJECT_LABELS).map(([id, label]) => ({ id, label })),
};

const config = {
  id: EPCAR_PROVIDER_ID,
  metadata: epcarMetadata,
  institution: "FAB",
  keys: KEYS,
  subjectLabels: SUBJECT_LABELS,
};

export function epcarFirstPhaseQuestions(year: number) {
  const key = epcarAnswerKey(year);
  return key ? fabQuestionsForKey(config, key) : [];
}

export const epcarProvider: ExamProvider = buildFabProvider(config);
