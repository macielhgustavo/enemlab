// Provider do ENEM: adapta a API pública e a classificação já existentes
// aos contratos genéricos, sem alterar as regras de estudo.
import { fetchExam } from "../api/enem";
import { AREA_LABELS, AREA_ORDER, examYears } from "../domain/constants";
import { classifyQuestion, discipline, questionKey } from "../domain/classify";
import { inspectQuestion } from "../domain/question-quality";
import type { Language, Question } from "../domain/types";
import type {
  ExamMetadata,
  ExamPhase,
  ExamProvider,
  FetchQuestionsParams,
  NormalizedQuestion,
} from "./types";

export const ENEM_PROVIDER_ID = "enem";

// Linguagens e humanas caem no dia 1; matemática e natureza no dia 2.
const DAY1 = new Set(["linguagens", "ciencias-humanas"]);

function phaseForArea(area: string): ExamPhase {
  return DAY1.has(area) ? "day1" : "day2";
}

export const enemMetadata: ExamMetadata = {
  id: ENEM_PROVIDER_ID,
  label: "Exame Nacional do Ensino Médio",
  shortLabel: "ENEM",
  years: examYears(),
  languages: [
    { id: "ingles", label: "Inglês" },
    { id: "espanhol", label: "Espanhol" },
  ],
  phases: ["day1", "day2"],
  hasEssay: true,
  areas: AREA_ORDER.map((id) => ({ id, label: AREA_LABELS[id] })),
};

/** Converte a questão bruta da API no formato normalizado. */
export function normalizeEnemQuestion(q: Question): NormalizedQuestion {
  const area = discipline(q);
  const correct = q.correctAlternative ?? null;
  const classification = classifyQuestion(q);
  const quality = inspectQuestion(q);
  return {
    providerId: ENEM_PROVIDER_ID,
    examId: `enem-${q.year}`,
    year: q.year,
    index: q.index,
    phase: phaseForArea(area),
    language: q.language ?? null,
    subject: { id: area, label: AREA_LABELS[area] || area, area },
    content: classification.primary,
    classification: {
      primary: classification.primary,
      tags: classification.tags,
      path: classification.path,
      subtopic: classification.subtopic,
      confidence: classification.confidence,
      score: classification.score,
    },
    quality: {
      score: quality.score,
      status: quality.status,
      scoreable: quality.scoreable,
      issueCodes: quality.issues.map((x) => x.code),
    },
    context: q.context ?? null,
    alternativesIntroduction: q.alternativesIntroduction ?? null,
    alternatives: (q.alternatives || []).map((a) => ({
      letter: a.letter,
      text: a.text ?? null,
      file: a.file ?? null,
      isCorrect: a.isCorrect ?? a.letter === correct,
    })),
    correctAlternative: correct,
    files: q.files || [],
    sources: [],
  };
}

export const enemProvider: ExamProvider = {
  id: ENEM_PROVIDER_ID,
  metadata: enemMetadata,
  async fetchQuestions({ year, language, force }: FetchQuestionsParams) {
    const raw = await fetchExam(year, (language || "ingles") as Language, force);
    return raw.map(normalizeEnemQuestion);
  },
  questionKey(q: NormalizedQuestion) {
    // Mesma chave usada pelo histórico legado, para não invalidar dados.
    return questionKey({
      year: q.year,
      index: q.index,
      language: q.language,
      discipline: q.subject.area,
    } as Question);
  },
};
