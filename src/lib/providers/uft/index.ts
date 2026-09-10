import raw from "./answer-keys.generated.json";
import {
  normalizeReferenceCatalog,
  referenceQuestionKey,
  referenceQuestionsForKey,
  type ReferenceAnswerKeyRaw,
} from "../vestibular-reference";
import type { ExamMetadata, ExamProvider } from "../types";

export const UFT_PROVIDER_ID = "uft";
const catalog = normalizeReferenceCatalog(
  "uft",
  raw as unknown as Record<string, ReferenceAnswerKeyRaw>,
);
export const uftEditions = () =>
  Object.values(catalog).map((key) => ({
    id: key.edition,
    label: key.label,
    year: key.year,
  }));
export const uftAnswerKey = (edition: string) => catalog[edition] ?? null;
export const uftMetadata: ExamMetadata = {
  id: "uft",
  label: "Universidade Federal do Tocantins",
  shortLabel: "UFT",
  years: [2025],
  editions: uftEditions(),
  languages: [],
  phases: ["afternoon"],
  hasEssay: false,
  areas: [
    { id: "ciencias-humanas", label: "Ciências Humanas" },
    { id: "ciencias-natureza", label: "Ciências da Natureza" },
  ],
};
export const uftProvider: ExamProvider = {
  id: "uft",
  metadata: uftMetadata,
  async fetchQuestions({ year, editionId }) {
    return Object.values(catalog)
      .filter((key) => key.year === year && (!editionId || key.edition === editionId))
      .flatMap((key) =>
        referenceQuestionsForKey(
          {
            id: "uft",
            institution: "UFT / COPESE",
            metadata: uftMetadata,
            keys: catalog,
            useNamedEditionId: true,
            alternativeLetters: ["A", "B", "C", "D"],
          },
          key,
        ),
      );
  },
  questionKey: (question) => referenceQuestionKey("uft", question),
};
