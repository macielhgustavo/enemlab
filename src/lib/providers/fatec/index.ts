import {
  normalizeReferenceCatalog,
  referenceMeasure,
  referenceQuestionKey,
  referenceQuestionsForKey,
  type ReferenceAnswerKey,
} from "../vestibular-reference";
import type { ExamMetadata, ExamProvider, NormalizedQuestion } from "../types";
import { buildFatecRawCatalog } from "./data";

export const FATEC_PROVIDER_ID = "fatec";
const CATALOG = normalizeReferenceCatalog(FATEC_PROVIDER_ID, buildFatecRawCatalog());
const EDITIONS = Object.values(CATALOG).map((key) => ({ id: key.edition, label: key.label, year: key.year })).sort((left, right) => right.id.localeCompare(left.id, "pt-BR", { numeric: true }));

export function fatecEditions() { return EDITIONS; }
export function fatecYears(): number[] { return [...new Set(EDITIONS.map((edition) => edition.year))].sort((a, b) => b - a); }
export function fatecAnswerKey(editionId: string): ReferenceAnswerKey | null { return CATALOG[editionId] ?? null; }
export function fatecExamUrl(editionId: string): string | null { return fatecAnswerKey(editionId)?.examUrl ?? null; }
export function fatecQuestions(editionId: string): NormalizedQuestion[] { const key = fatecAnswerKey(editionId); return key ? referenceQuestionsForKey(fatecProviderConfig, key) : []; }
export function fatecQuestionKey(question: NormalizedQuestion): string { return referenceQuestionKey(FATEC_PROVIDER_ID, question); }
export function fatecMeasure(editionId: string) { const key = fatecAnswerKey(editionId); return key ? referenceMeasure(key) : null; }

export const fatecMetadata: ExamMetadata = {
  id: FATEC_PROVIDER_ID,
  label: "Faculdades de Tecnologia do Estado de São Paulo",
  shortLabel: "FATEC",
  years: fatecYears(),
  editions: fatecEditions(),
  languages: [],
  phases: ["single"],
  hasEssay: false,
  areas: [{ id: "conhecimentos-gerais", label: "Conhecimentos gerais" }],
};

const fatecProviderConfig = { id: FATEC_PROVIDER_ID, institution: "Centro Paula Souza/FATEC", metadata: fatecMetadata, keys: CATALOG, useNamedEditionId: true };

export const fatecProvider: ExamProvider = {
  id: FATEC_PROVIDER_ID,
  metadata: fatecMetadata,
  async fetchQuestions({ year, editionId }) {
    const editions = editionId ? [editionId] : EDITIONS.filter((edition) => edition.year === year).map((edition) => edition.id);
    return editions.flatMap(fatecQuestions);
  },
  questionKey: fatecQuestionKey,
};
