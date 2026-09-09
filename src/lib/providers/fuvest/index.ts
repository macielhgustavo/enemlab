// Provider da FUVEST (1ª fase).

import type {
  ExamMetadata,
  ExamProvider,
  ExamSubject,
  NormalizedQuestion,
} from "../types";
import type { EditionVariants } from "../../catalog/variant";
import bruto from "./answer-keys.generated.json";
import { getStructuredQuestion } from "../structuredRegistry";

export const FUVEST_PROVIDER_ID = "fuvest";

const LETTERS = ["A", "B", "C", "D", "E"] as const;

const SUBJECT_GERAL: ExamSubject = {
  id: "conhecimentos-gerais",
  label: "Conhecimentos gerais",
  area: "conhecimentos-gerais",
};

export interface FuvestVariantRaw {
  id: string;
  label: string;
  examUrl: string | null;
}

export interface FuvestAnswerKey {
  edition: string;
  year: number;
  total: number;
  canonicalVariant: string;
  variantRelation: "reordered" | "distinct" | "unknown";
  revision: string;
  answers: Record<string, string>;
  annulled: number[];
  variants: FuvestVariantRaw[];
  answerKeyUrl: string;
  examUrl: string | null;
  secondPhaseUrls: string[];
  archivePage: string;
  parserVersion: string;
}

const CATALOGO = bruto as unknown as Record<string, FuvestAnswerKey>;

export function fuvestYears(): number[] {
  return Object.values(CATALOGO)
    .map((k) => k.year)
    .sort((a, b) => b - a);
}

export function fuvestAnswerKey(year: number): FuvestAnswerKey | null {
  return CATALOGO[String(year)] ?? null;
}

export function fuvestVariants(year: number): EditionVariants | null {
  const k = fuvestAnswerKey(year);
  if (!k) return null;
  return {
    relation: k.variantRelation,
    canonical: k.canonicalVariant,
    variants: k.variants.map((v) => ({
      id: v.id,
      label: v.label,
      examUrl: v.examUrl ?? undefined,
    })),
  };
}

export function fuvestExamUrl(year: number): string | null {
  return fuvestAnswerKey(year)?.examUrl ?? null;
}

export function fuvestSecondPhaseUrls(year: number): string[] {
  return fuvestAnswerKey(year)?.secondPhaseUrls ?? [];
}

export function fuvestQuestionKey(q: NormalizedQuestion): string {
  return `fuvest-${q.year}-first-${q.number ?? q.index}`;
}

export function fuvestFirstPhaseQuestions(year: number): NormalizedQuestion[] {
  const k = fuvestAnswerKey(year);
  if (!k) return [];

  const documentUrl = k.examUrl ?? k.answerKeyUrl;
  const out: NormalizedQuestion[] = [];

  for (let n = 1; n <= k.total; n++) {
    const annulled = k.annulled.includes(n);
    const correct = annulled ? null : (k.answers[String(n)] ?? null);

    const struct = getStructuredQuestion("fuvest", year, n, "first");
    const statementAvailable = Boolean(struct);
    const statementText = struct
      ? struct.statement
      : `[Questão ${n} - FUVEST] Consulte o caderno de prova oficial para o enunciado completo.`;

    out.push({
      providerId: FUVEST_PROVIDER_ID,
      examId: `fuvest-${year}-first`,
      year,
      index: n,
      number: n,
      phase: "first",
      language: null,
      subject: SUBJECT_GERAL,
      content: statementText,
      context: struct?.context ?? null,
      alternativesIntroduction: null,
      alternatives: LETTERS.map((letter) => {
        const altStruct = struct?.alternatives.find((a) => a.letter === letter);
        return {
          letter,
          text: altStruct ? altStruct.text : null,
          file: null,
          isCorrect: correct === letter,
        };
      }),
      correctAlternative: correct,
      files: [],
      sources: [],
      type: "multiple_choice",
      statementAvailable,
      official: { official: true, institution: "FUVEST", documentUrl },
      expectedAnswer: null,
    });
  }

  return out;
}

export const fuvestMetadata: ExamMetadata = {
  id: FUVEST_PROVIDER_ID,
  label: "Fundação Universitária para o Vestibular",
  shortLabel: "FUVEST",
  years: fuvestYears(),
  languages: [],
  phases: ["first"],
  hasEssay: false,
  areas: [{ id: SUBJECT_GERAL.id, label: SUBJECT_GERAL.label }],
};

export const fuvestProvider: ExamProvider = {
  id: FUVEST_PROVIDER_ID,
  metadata: fuvestMetadata,
  async fetchQuestions({ year }) {
    return fuvestFirstPhaseQuestions(year);
  },
  questionKey: fuvestQuestionKey,
};
