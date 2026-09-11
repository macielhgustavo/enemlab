import type {
  ExamMetadata,
  ExamPhase,
  ExamProvider,
  ExamSubject,
  NormalizedQuestion,
} from "../types";
import bruto from "./answer-keys.generated.json";

export const ESPCEX_PROVIDER_ID = "espcex";

const LETTERS = ["A", "B", "C", "D", "E"] as const;

const SUBJECTS: Record<string, { label: string; area: string }> = {
  portuguese: { label: "Português", area: "linguagens" },
  english: { label: "Inglês", area: "linguagens" },
  mathematics: { label: "Matemática", area: "matematica" },
  physics: { label: "Física", area: "ciencias-natureza" },
  chemistry: { label: "Química", area: "ciencias-natureza" },
  geography: { label: "Geografia", area: "ciencias-humanas" },
  history: { label: "História", area: "ciencias-humanas" },
};

export interface EspcexDayKey {
  model: string;
  total: number;
  examUrl: string;
  examOfficial?: boolean;
  answerKeyUrl: string;
  verificationUrl: string;
  annulled: number[];
  subjects: Record<string, number[]>;
  answers: Record<string, string>;
}

export interface EspcexAnswerKey {
  year: number;
  revision: string;
  parserVersion: string;
  days: {
    day1: EspcexDayKey;
    day2: EspcexDayKey;
  };
}

const CATALOGO = bruto as unknown as Record<string, EspcexAnswerKey>;

export function espcexYears(): number[] {
  return Object.keys(CATALOGO)
    .map(Number)
    .sort((a, b) => b - a);
}

export function espcexAnswerKey(year: number): EspcexAnswerKey | null {
  return CATALOGO[String(year)] ?? null;
}

export function espcexExamUrl(year: number, phase: "day1" | "day2"): string | null {
  return espcexAnswerKey(year)?.days[phase].examUrl ?? null;
}

export function espcexAnswerKeyUrl(year: number, phase: "day1" | "day2"): string | null {
  return espcexAnswerKey(year)?.days[phase].answerKeyUrl ?? null;
}

function subjectOf(day: EspcexDayKey, n: number): ExamSubject {
  for (const [id, numbers] of Object.entries(day.subjects)) {
    if (numbers.includes(n)) {
      const metadata = SUBJECTS[id] ?? { label: id, area: id };
      return { id, label: metadata.label, area: metadata.area };
    }
  }
  return { id: "unknown", label: "Não classificada", area: "unknown" };
}

export function espcexQuestionKey(q: NormalizedQuestion): string {
  return `espcex-${q.year}-${q.phase}-${q.number ?? q.index}`;
}

function questionsForDay(year: number, phase: "day1" | "day2"): NormalizedQuestion[] {
  const key = espcexAnswerKey(year);
  if (!key) return [];
  const day = key.days[phase];

  return Array.from({ length: day.total }, (_, offset) => {
    const n = offset + 1;
    const annulled = day.annulled.includes(n);
    const correct = annulled ? null : (day.answers[String(n)] ?? null);
    const subject = subjectOf(day, n);

    return {
      providerId: ESPCEX_PROVIDER_ID,
      examId: `espcex-${year}-${phase}`,
      year,
      index: n,
      number: n,
      phase: phase as ExamPhase,
      language: null,
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
        official: day.examOfficial ?? true,
        institution: "EsPCEx",
        documentUrl: day.examUrl,
      },
      expectedAnswer: null,
    } satisfies NormalizedQuestion;
  });
}

export function espcexQuestions(year: number): NormalizedQuestion[] {
  if (!espcexAnswerKey(year)) return [];
  return [...questionsForDay(year, "day1"), ...questionsForDay(year, "day2")];
}

export const espcexMetadata: ExamMetadata = {
  id: ESPCEX_PROVIDER_ID,
  label: "Escola Preparatória de Cadetes do Exército",
  shortLabel: "EsPCEx",
  years: espcexYears(),
  languages: [],
  phases: ["day1", "day2"],
  hasEssay: true,
  areas: [
    { id: "linguagens", label: "Linguagens" },
    { id: "matematica", label: "Matemática" },
    { id: "ciencias-natureza", label: "Ciências da Natureza" },
    { id: "ciencias-humanas", label: "Ciências Humanas" },
  ],
};

export const espcexProvider: ExamProvider = {
  id: ESPCEX_PROVIDER_ID,
  metadata: espcexMetadata,
  async fetchQuestions({ year }) {
    return espcexQuestions(year);
  },
  questionKey: espcexQuestionKey,
};
