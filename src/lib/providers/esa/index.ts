import type { ExamMetadata, ExamProvider, ExamSubject, NormalizedQuestion } from "../types";
import bruto from "./answer-keys.generated.json";

export const ESA_PROVIDER_ID = "esa";
const LETTERS = ["A", "B", "C", "D", "E"] as const;

const SUBJECTS: Record<string, { label: string; area: string }> = {
  mathematics: { label: "Matemática", area: "matematica" },
  portuguese: { label: "Português", area: "linguagens" },
  history_geography: { label: "História e Geografia do Brasil", area: "ciencias-humanas" },
  english: { label: "Inglês", area: "linguagens" },
};

export interface EsaAnswerKey {
  year: number;
  revision: string;
  parserVersion: string;
  variant: string;
  total: number;
  examUrl: string;
  answerKeyUrl: string;
  officialArchiveUrl: string;
  verificationUrl: string;
  annulled: number[];
  subjects: Record<string, [number, number]>;
  answers: Record<string, string>;
}

const CATALOGO = bruto as unknown as Record<string, EsaAnswerKey>;

export function esaYears(): number[] {
  return Object.keys(CATALOGO).map(Number).sort((a, b) => b - a);
}

export function esaAnswerKey(year: number): EsaAnswerKey | null {
  return CATALOGO[String(year)] ?? null;
}

export function esaExamUrl(year: number): string | null {
  return esaAnswerKey(year)?.examUrl ?? null;
}

export function esaAnswerKeyUrl(year: number): string | null {
  return esaAnswerKey(year)?.answerKeyUrl ?? null;
}

function subjectOf(key: EsaAnswerKey, n: number): ExamSubject {
  for (const [id, [start, end]] of Object.entries(key.subjects)) {
    if (n >= start && n <= end) {
      const metadata = SUBJECTS[id] ?? { label: id, area: id };
      return { id, label: metadata.label, area: metadata.area };
    }
  }
  return { id: "unknown", label: "Não classificada", area: "unknown" };
}

export function esaQuestionKey(q: NormalizedQuestion): string {
  return `esa-${q.year}-${q.phase}-${q.number ?? q.index}`;
}

export function esaQuestions(year: number): NormalizedQuestion[] {
  const key = esaAnswerKey(year);
  if (!key) return [];

  return Array.from({ length: key.total }, (_, offset) => {
    const n = offset + 1;
    const annulled = key.annulled.includes(n);
    const correct = annulled ? null : (key.answers[String(n)] ?? null);
    const subject = subjectOf(key, n);

    return {
      providerId: ESA_PROVIDER_ID,
      examId: `esa-${year}-geral-${key.variant.toLowerCase()}`,
      editionId: `${year}-geral-${key.variant.toLowerCase()}`,
      year,
      index: n,
      number: n,
      phase: "single" as const,
      language: subject.id === "english" ? "ingles" : null,
      subject,
      content: subject.label,
      context: null,
      alternativesIntroduction: null,
      alternatives: LETTERS.map((letter) => ({
        letter,
        text: null,
        file: null,
        isCorrect: correct === letter,
      })),
      correctAlternative: correct,
      files: [],
      sources: [],
      type: "multiple_choice" as const,
      statementAvailable: false,
      official: {
        official: false,
        institution: "Escola de Sargentos das Armas",
        documentUrl: key.examUrl,
      },
      expectedAnswer: null,
    } satisfies NormalizedQuestion;
  });
}

export const esaMetadata: ExamMetadata = {
  id: ESA_PROVIDER_ID,
  label: "Escola de Sargentos das Armas — Área Geral",
  shortLabel: "ESA",
  years: esaYears(),
  languages: [],
  phases: ["single"],
  hasEssay: true,
  areas: [
    { id: "linguagens", label: "Linguagens" },
    { id: "matematica", label: "Matemática" },
    { id: "ciencias-humanas", label: "Ciências Humanas" },
  ],
};

export const esaProvider: ExamProvider = {
  id: ESA_PROVIDER_ID,
  metadata: esaMetadata,
  async fetchQuestions({ year }) {
    return esaQuestions(year);
  },
  questionKey: esaQuestionKey,
};
