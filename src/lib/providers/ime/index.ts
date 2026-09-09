// Provider do IME (Concurso de Admissão ao CFG).

import type {
  ExamMetadata,
  ExamProvider,
  ExamSubject,
  NormalizedQuestion,
} from "../types";
import bruto from "./answer-keys.generated.json";
import { getStructuredQuestion } from "../structuredRegistry";

export const IME_PROVIDER_ID = "ime";

const SUBJECT_LABELS: Record<string, string> = {
  mathematics: "Matemática",
  physics: "Física",
  chemistry: "Química",
};

const LETTERS = ["A", "B", "C", "D", "E"] as const;

export interface ImeAnswerKey {
  edition: string;
  year: number;
  total: number;
  answers: Record<string, string>;
  annulled: number[];
  subjects: Record<string, number[]>;
  revision: string;
  answerKeyUrl: string;
  examUrl: string | null;
  parserVersion: string;
}

const CATALOGO = bruto as unknown as Record<string, ImeAnswerKey>;

/** Edições ingeridas, da mais recente para a mais antiga. */
export function imeEditions(): string[] {
  return Object.keys(CATALOGO).sort((a, b) => b.localeCompare(a));
}

/** Anos de ingresso, para a interface que pensa em ano. */
export function imeYears(): number[] {
  return imeEditions()
    .map((e) => CATALOGO[e].year)
    .sort((a, b) => b - a);
}

/** Edição correspondente a um ano de ingresso. */
export function imeEditionOfYear(year: number): string | null {
  return imeEditions().find((e) => CATALOGO[e].year === year) ?? null;
}

export function imeAnswerKey(edition: string): ImeAnswerKey | null {
  return CATALOGO[edition] ?? null;
}

/** PDF oficial da objetiva. É onde o aluno lê o enunciado. */
export function imeExamUrl(edition: string): string | null {
  return CATALOGO[edition]?.examUrl ?? null;
}

export function imeAnswerKeyUrl(edition: string): string | null {
  return CATALOGO[edition]?.answerKeyUrl ?? null;
}

function subjectOf(k: ImeAnswerKey, n: number): string {
  for (const [id, nums] of Object.entries(k.subjects)) {
    if (nums.includes(n)) return id;
  }
  return "unknown";
}

/** Chave estável, sem colisão com as outras provas. */
export function imeQuestionKey(q: NormalizedQuestion): string {
  return `ime-${q.examId.replace(/^ime-/, "")}-${q.number ?? q.index}`;
}

export function imeObjectiveQuestions(edition: string): NormalizedQuestion[] {
  const k = imeAnswerKey(edition);
  if (!k) return [];

  const documentUrl = k.examUrl ?? k.answerKeyUrl;
  const out: NormalizedQuestion[] = [];

  for (let n = 1; n <= k.total; n++) {
    const annulled = k.annulled.includes(n);
    const correct = annulled ? null : (k.answers[String(n)] ?? null);
    const subjectId = subjectOf(k, n);
    const subject: ExamSubject = {
      id: subjectId,
      label: SUBJECT_LABELS[subjectId] ?? subjectId,
      area: subjectId,
    };

    const struct = getStructuredQuestion("ime", k.year, n, "first");
    const statementAvailable = Boolean(struct);
    const statementText = struct
      ? struct.statement
      : `[Questão ${n} - ${subject.label}] Consulte o caderno de prova oficial para o enunciado completo.`;

    out.push({
      providerId: IME_PROVIDER_ID,
      examId: `ime-${edition}-objective`,
      year: k.year,
      index: n,
      number: n,
      phase: "first",
      language: null,
      subject,
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
      official: { official: true, institution: "IME", documentUrl },
      expectedAnswer: null,
    });
  }

  return out;
}

export const imeMetadata: ExamMetadata = {
  id: IME_PROVIDER_ID,
  label: "Instituto Militar de Engenharia",
  shortLabel: "IME",
  years: imeYears(),
  languages: [],
  phases: ["first"],
  hasEssay: false,
  areas: Object.entries(SUBJECT_LABELS).map(([id, label]) => ({ id, label })),
};

export const imeProvider: ExamProvider = {
  id: IME_PROVIDER_ID,
  metadata: imeMetadata,
  async fetchQuestions({ year }) {
    const edition = imeEditionOfYear(year);
    return edition ? imeObjectiveQuestions(edition) : [];
  },
  questionKey: imeQuestionKey,
};
