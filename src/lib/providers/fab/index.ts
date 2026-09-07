import type { EditionVariants } from "../../catalog/variant";
import type {
  ExamMetadata,
  ExamProvider,
  ExamSubject,
  NormalizedQuestion,
} from "../types";

export const FAB_ARCHIVE_URL = "https://www.fab.mil.br/ingresso/provas.html";
const LETTERS = ["A", "B", "C", "D"] as const;

export interface FabVariantRaw {
  id: string;
  label: string;
  examUrl: string | null;
}

export interface FabAnswerKeyRaw {
  edition: string;
  year: number;
  total: number;
  canonicalVariant: string;
  variantRelation: "reordered" | "distinct" | "unknown";
  revision: "preliminary" | "final" | "rectified";
  sequence: string;
  annulled: number[];
  variants: FabVariantRaw[];
  answerKeyUrl: string;
  examUrl: string | null;
  archivePage: string;
  subjects: Record<string, [number, number]>;
  parserVersion: string;
}

export interface FabAnswerKey extends Omit<FabAnswerKeyRaw, "sequence" | "subjects"> {
  answers: Record<string, string>;
  subjects: Record<string, number[]>;
}

export interface FabProviderConfig {
  id: string;
  metadata: ExamMetadata;
  institution: string;
  keys: Record<string, FabAnswerKey>;
  subjectLabels: Record<string, string>;
}

function tokensOf(sequence: string): string[] {
  return sequence
    .trim()
    .toUpperCase()
    .split(/[\s|]+/)
    .filter(Boolean);
}

function numbersInRange(range: [number, number]): number[] {
  const [first, last] = range;
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

export function parseFabAnswerSequence(
  sequence: string,
  total: number,
  annulled: number[],
): Record<string, string> {
  const tokens = tokensOf(sequence);
  const errors: string[] = [];
  const anuladas = new Set(annulled);

  if (tokens.length !== total) {
    errors.push(`sequência cobre ${tokens.length} questões, esperava ${total}`);
  }

  const answers: Record<string, string> = {};
  for (let index = 0; index < Math.min(tokens.length, total); index++) {
    const number = index + 1;
    const token = tokens[index];
    if (token === "X" || token === "ANULADA" || token === "ANULADO") {
      if (!anuladas.has(number)) errors.push(`questão ${number} marcada como anulada sem registro`);
      continue;
    }
    if (!LETTERS.includes(token as (typeof LETTERS)[number])) {
      errors.push(`questão ${number} tem letra inválida: ${token}`);
      continue;
    }
    if (anuladas.has(number)) errors.push(`questão ${number} anulada com resposta ${token}`);
    answers[String(number)] = token;
  }

  const expectedAnnulled = [...anuladas].sort((a, b) => a - b);
  for (const number of expectedAnnulled) {
    if (number < 1 || number > total) errors.push(`anulada fora do intervalo: ${number}`);
    if (number <= tokens.length && !["X", "ANULADA", "ANULADO"].includes(tokens[number - 1])) {
      errors.push(`questão anulada ${number} não está marcada na sequência`);
    }
  }

  if (errors.length) throw new Error(`gabarito FAB inválido: ${errors.join("; ")}`);
  return answers;
}

export function normalizeFabAnswerKey(raw: FabAnswerKeyRaw): FabAnswerKey {
  if (raw.revision !== "final" && raw.revision !== "rectified") {
    throw new Error(`gabarito FAB ${raw.edition} não é final`);
  }
  if (raw.variantRelation !== "reordered") {
    throw new Error(`variantes FAB ${raw.edition} têm relação não suportada`);
  }
  if (!raw.variants.some((variant) => variant.id === raw.canonicalVariant)) {
    throw new Error(`variante canônica ausente em FAB ${raw.edition}`);
  }

  const answers = parseFabAnswerSequence(raw.sequence, raw.total, raw.annulled);
  const subjects = Object.fromEntries(
    Object.entries(raw.subjects).map(([id, range]) => [id, numbersInRange(range)]),
  );
  const subjectNumbers = Object.values(subjects).flat();
  const uniqueSubjectNumbers = new Set(subjectNumbers);
  const expectedNumbers = Array.from({ length: raw.total }, (_, index) => index + 1);
  if (
    subjectNumbers.length !== raw.total ||
    uniqueSubjectNumbers.size !== raw.total ||
    expectedNumbers.some((number) => !uniqueSubjectNumbers.has(number))
  ) {
    throw new Error(`matérias FAB ${raw.edition} não cobrem 1..${raw.total} exatamente`);
  }

  return { ...raw, answers, subjects };
}

export function fabVariants(key: FabAnswerKey): EditionVariants {
  return {
    relation: key.variantRelation,
    canonical: key.canonicalVariant,
    variants: key.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      examUrl: variant.examUrl ?? undefined,
    })),
  };
}

function subjectOf(key: FabAnswerKey, number: number): string {
  for (const [id, numbers] of Object.entries(key.subjects)) {
    if (numbers.includes(number)) return id;
  }
  return "unknown";
}

export function fabQuestionKey(providerId: string, year: number, phase: string, number: number): string {
  return `${providerId}-${year}-${phase}-${number}`;
}

export function fabQuestionsForKey(config: FabProviderConfig, key: FabAnswerKey): NormalizedQuestion[] {
  const documentUrl = key.examUrl ?? key.answerKeyUrl;
  const questions: NormalizedQuestion[] = [];

  for (let number = 1; number <= key.total; number++) {
    const subjectId = subjectOf(key, number);
    const correct = key.annulled.includes(number) ? null : key.answers[String(number)] ?? null;
    const subject: ExamSubject = {
      id: subjectId,
      label: config.subjectLabels[subjectId] ?? subjectId,
      area: subjectId,
    };

    questions.push({
      providerId: config.id,
      examId: `${config.id}-${key.edition}-first`,
      year: key.year,
      index: number,
      number,
      phase: "first",
      language: subjectId === "english" ? "ingles" : null,
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
      type: "multiple_choice",
      statementAvailable: false,
      official: { official: true, institution: config.institution, documentUrl },
      expectedAnswer: null,
    });
  }

  return questions;
}

export function buildFabProvider(config: FabProviderConfig): ExamProvider {
  return {
    id: config.id,
    metadata: config.metadata,
    async fetchQuestions({ year }) {
      const key = config.keys[String(year)];
      return key ? fabQuestionsForKey(config, key) : [];
    },
    questionKey(question) {
      return fabQuestionKey(config.id, question.year, question.phase, question.number ?? question.index);
    },
  };
}
