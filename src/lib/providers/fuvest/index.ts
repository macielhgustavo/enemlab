// Provider da FUVEST (1ª fase).
//
// É a primeira prova com **variantes** no catálogo, e o motivo de o
// `ExamVariant` ter vindo antes desta wave.
//
// A FUVEST aplica a mesma prova em várias versões, com as questões em ordem
// diferente, e publica um único gabarito com todas em colunas. Em 2025 foram
// quatro versões chamadas V1..V4; em 2024, cinco chamadas V, K, Q, X e Z —
// razão pela qual o importador lê os nomes do documento, nunca do código.
//
// Só a versão canônica vira questão. As 22 edições aceitas somam 2.000
// referências canônicas; duplicar cadernos reordenados corromperia o SRS.

import type {
  ExamMetadata,
  ExamProvider,
  ExamSubject,
  NormalizedQuestion,
} from "../types";
import type { EditionVariants } from "../../catalog/variant";
import bruto from "./answer-keys.generated.json";
import {
  getStructuredQuestion,
  withStructuredQuestionContent,
} from "../structuredRegistry";

export const FUVEST_PROVIDER_ID = "fuvest";

const LETTERS = ["A", "B", "C", "D", "E"] as const;

/**
 * A 1ª fase é de conhecimentos gerais: uma prova só, sem separação por
 * matéria no gabarito. Declarar matérias que o documento não distingue
 * seria inventar classificação.
 */
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

export interface FuvestRetrieval {
  originalUrl: string;
  effectiveSourceUrl: string;
  sourceType: "pdf-reference";
  fetchedAt: string;
  sha256: string;
  bytes: number;
  parserVersion: string;
  revision: string;
  final: boolean;
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
  sourceType: "pdf-reference";
  contentMode: "reference-only";
  rightsStatus: "official-reference";
  validationLevel: "reviewed";
  expectedQuestions: number;
  parsedQuestions: number;
  validationEvidence: string[];
  retrieval: FuvestRetrieval;
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

/** Versões aplicadas numa edição, no modelo do catálogo. */
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

/** PDF da versão canônica — onde o aluno lê o enunciado. */
export function fuvestExamUrl(year: number): string | null {
  return fuvestAnswerKey(year)?.examUrl ?? null;
}

/**
 * Documentos da 2ª fase.
 *
 * Registrados e não executáveis: a 2ª fase é discursiva, não há correção
 * automática, e inventar uma seria pior que não ter.
 */
export function fuvestSecondPhaseUrls(year: number): string[] {
  return fuvestAnswerKey(year)?.secondPhaseUrls ?? [];
}

export function fuvestQuestionKey(q: NormalizedQuestion): string {
  // Sem variante na chave: as versões são a mesma prova reordenada, e
  // incluí-la criaria uma identidade por caderno para a mesma questão.
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

    const base: NormalizedQuestion = {
      providerId: FUVEST_PROVIDER_ID,
      examId: `fuvest-${year}-first`,
      year,
      index: n,
      number: n,
      phase: "first",
      language: null,
      subject: SUBJECT_GERAL,
      content: SUBJECT_GERAL.label,
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
      type: "multiple_choice",
      statementAvailable: false,
      official: { official: true, institution: "FUVEST", documentUrl },
      expectedAnswer: null,
    };

    out.push(
      withStructuredQuestionContent(
        base,
        getStructuredQuestion(FUVEST_PROVIDER_ID, year, n, "first"),
        "FUVEST",
      ),
    );
  }

  return out;
}

export const fuvestMetadata: ExamMetadata = {
  id: FUVEST_PROVIDER_ID,
  label: "Fundação Universitária para o Vestibular",
  shortLabel: "FUVEST",
  years: fuvestYears(),
  languages: [],
  // A 2ª fase existe e está registrada na fonte, mas não é executável.
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
