import {
  normalizeReferenceCatalog,
  referenceMeasure,
  referenceQuestionKey,
  referenceQuestionsForKey,
  type ReferenceAnswerKey,
} from "../vestibular-reference";
import type { ExamMetadata, ExamProvider, NormalizedQuestion } from "../types";
import { buildEearRawCatalog } from "./data";
import { EEAR_SPECS_2017_2019 } from "./eear-2017-2019.generated";
import { EEAR_SPECS_2020_2022 } from "./eear-2020-2022.generated";
import { EEAR_SPECS_2023_2025 } from "./eear-2023-2025.generated";

export const EEAR_PROVIDER_ID = "eear";

const SPECS = [
  ...EEAR_SPECS_2017_2019,
  ...EEAR_SPECS_2020_2022,
  ...EEAR_SPECS_2023_2025,
];
const CATALOG = normalizeReferenceCatalog(EEAR_PROVIDER_ID, buildEearRawCatalog(SPECS));
const EDITIONS = Object.values(CATALOG)
  .map((key) => ({ id: key.edition, label: key.label, year: key.year }))
  .sort((left, right) => right.id.localeCompare(left.id, "pt-BR", { numeric: true }));

export function eearEditions() {
  return EDITIONS;
}

export function eearYears(): number[] {
  return [...new Set(EDITIONS.map((edition) => edition.year))].sort((a, b) => b - a);
}

export function eearAnswerKey(editionId: string): ReferenceAnswerKey | null {
  return CATALOG[editionId] ?? null;
}

export function eearExamUrl(editionId: string): string | null {
  return eearAnswerKey(editionId)?.examUrl ?? null;
}

export function eearQuestions(editionId: string): NormalizedQuestion[] {
  const key = eearAnswerKey(editionId);
  return key ? referenceQuestionsForKey(eearProviderConfig, key) : [];
}

export function eearQuestionKey(question: NormalizedQuestion): string {
  return referenceQuestionKey(EEAR_PROVIDER_ID, question);
}

export function eearMeasure(editionId: string) {
  const key = eearAnswerKey(editionId);
  return key ? referenceMeasure(key) : null;
}

export const eearMetadata: ExamMetadata = {
  id: EEAR_PROVIDER_ID,
  label: "Escola de Especialistas de Aeronáutica",
  shortLabel: "EEAR",
  years: eearYears(),
  editions: eearEditions(),
  languages: [{ id: "ingles", label: "Inglês" }],
  phases: ["single"],
  hasEssay: false,
  areas: [
    { id: "linguagens", label: "Linguagens" },
    { id: "matematica", label: "Matemática" },
    { id: "ciencias-natureza", label: "Ciências da Natureza" },
    { id: "conhecimentos-especificos", label: "Conhecimentos específicos" },
  ],
};

const eearProviderConfig = {
  id: EEAR_PROVIDER_ID,
  institution: "EEAR/FAB",
  metadata: eearMetadata,
  keys: CATALOG,
  useNamedEditionId: true,
};

export const eearProvider: ExamProvider = {
  id: EEAR_PROVIDER_ID,
  metadata: eearMetadata,
  async fetchQuestions({ year, editionId }) {
    const editions = editionId
      ? [editionId]
      : EDITIONS.filter((edition) => edition.year === year).map((edition) => edition.id);
    return editions.flatMap(eearQuestions);
  },
  questionKey: eearQuestionKey,
};
