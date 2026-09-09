import { buildQuestionKey } from "../../catalog/question-key";
import type { EditionVariants } from "../../catalog/variant";
import type { ValidationLevel } from "../../sources/ingestion";
import type {
  ExamMetadata,
  ExamPhase,
  ExamProvider,
  ExamSubject,
  NormalizedQuestion,
} from "../types";

const LETTERS = ["A", "B", "C", "D", "E"] as const;

export interface ReferenceSubjectRaw {
  id: string;
  label: string;
  area: string;
  range?: [number, number];
  numbers?: number[];
}

export interface ReferenceVariantRaw {
  id: string;
  label: string;
  examUrl: string | null;
  answerKeyUrl?: string | null;
}

export interface ReferenceRetrieval {
  originalUrl: string;
  effectiveSourceUrl: string;
  sourceType: "pdf-reference";
  fetchedAt: string;
  sha256: string;
  bytes: number;
  parserVersion: string;
  revision: "preliminary" | "final" | "rectified";
  final: boolean;
}

export interface ReferenceAnswerKeyRaw {
  edition: string;
  year: number;
  label: string;
  phase: ExamPhase;
  total: number;
  canonicalVariant: string;
  variantRelation: "reordered" | "distinct" | "unknown";
  revision: "preliminary" | "final" | "rectified";
  answers: Record<string, string>;
  annulled: number[];
  variants: ReferenceVariantRaw[];
  answerKeyUrl: string;
  examUrl: string | null;
  archivePage: string;
  subjects: ReferenceSubjectRaw[];
  contentMode: "reference-only";
  rightsStatus: "official-reference" | "permission-required" | "unknown" | "allowed";
  validationLevel: ValidationLevel;
  validationEvidence: string[];
  retrieval: ReferenceRetrieval;
  parserVersion: string;
}

export interface ReferenceSubject extends ExamSubject {
  numbers: number[];
}

export interface ReferenceAnswerKey extends Omit<ReferenceAnswerKeyRaw, "subjects"> {
  subjects: ReferenceSubject[];
}

export interface ReferenceProviderConfig {
  id: string;
  institution: string;
  metadata: ExamMetadata;
  keys: Record<string, ReferenceAnswerKey>;
  defaultLanguage?: string | null;
}

function expandSubject(subject: ReferenceSubjectRaw): ReferenceSubject {
  const numbers = subject.numbers ?? (
    subject.range
      ? Array.from(
          { length: subject.range[1] - subject.range[0] + 1 },
          (_, index) => subject.range![0] + index,
        )
      : []
  );
  return { id: subject.id, label: subject.label, area: subject.area, numbers };
}

function validateKey(providerId: string, raw: ReferenceAnswerKeyRaw): ReferenceAnswerKey {
  const errors: string[] = [];
  if (raw.revision === "preliminary" || !raw.retrieval.final) {
    errors.push("gabarito preliminar não pode virar provider executável");
  }
  if (raw.contentMode !== "reference-only") errors.push("modo de conteúdo inesperado");
  if (!raw.variants.some((variant) => variant.id === raw.canonicalVariant)) {
    errors.push(`variante canônica ausente: ${raw.canonicalVariant}`);
  }

  const answered = new Set(Object.keys(raw.answers).map(Number));
  const annulled = new Set(raw.annulled);
  const expected = new Set(Array.from({ length: raw.total }, (_, index) => index + 1));
  for (const number of expected) {
    if (!answered.has(number) && !annulled.has(number)) errors.push(`questão faltante: ${number}`);
  }
  for (const number of [...answered, ...annulled]) {
    if (!expected.has(number)) errors.push(`questão fora do intervalo: ${number}`);
  }
  for (const number of annulled) {
    if (answered.has(number)) errors.push(`questão anulada com resposta: ${number}`);
  }
  for (const [number, answer] of Object.entries(raw.answers)) {
    if (!LETTERS.includes(answer as (typeof LETTERS)[number])) {
      errors.push(`q${number} tem alternativa inválida: ${answer}`);
    }
  }

  const subjects = raw.subjects.map(expandSubject);
  const subjectNumbers = subjects.flatMap((subject) => subject.numbers);
  const uniqueSubjectNumbers = new Set(subjectNumbers);
  if (subjectNumbers.length !== raw.total || uniqueSubjectNumbers.size !== raw.total) {
    errors.push("matérias não cobrem a edição exatamente uma vez");
  }
  for (const number of expected) {
    if (!uniqueSubjectNumbers.has(number)) errors.push(`questão sem matéria: ${number}`);
  }

  if (errors.length) {
    throw new Error(`${providerId} ${raw.edition} inválido: ${errors.join("; ")}`);
  }
  return { ...raw, subjects };
}

export function normalizeReferenceCatalog(
  providerId: string,
  raw: Record<string, ReferenceAnswerKeyRaw>,
): Record<string, ReferenceAnswerKey> {
  return Object.fromEntries(
    Object.entries(raw).map(([year, key]) => [year, validateKey(providerId, key)]),
  );
}

export function referenceYears(keys: Record<string, ReferenceAnswerKey>): number[] {
  return Object.values(keys)
    .map((key) => key.year)
    .sort((a, b) => b - a);
}

export function referenceAnswerKey(
  keys: Record<string, ReferenceAnswerKey>,
  year: number,
): ReferenceAnswerKey | null {
  return keys[String(year)] ?? null;
}

export function referenceVariants(key: ReferenceAnswerKey): EditionVariants {
  return {
    relation: key.variantRelation,
    canonical: key.canonicalVariant,
    variants: key.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      examUrl: variant.examUrl ?? undefined,
      answerKeyUrl: variant.answerKeyUrl ?? undefined,
    })),
  };
}

export function referenceQuestionKey(providerId: string, q: NormalizedQuestion): string {
  return buildQuestionKey({
    providerId,
    editionId: String(q.year),
    phase: q.phase,
    language: q.language,
    number: q.number ?? q.index,
  });
}

function subjectOf(key: ReferenceAnswerKey, number: number): ReferenceSubject {
  const subject = key.subjects.find((candidate) => candidate.numbers.includes(number));
  if (!subject) throw new Error(`${key.edition}: questão ${number} sem matéria`);
  return subject;
}

export function referenceMeasure(key: ReferenceAnswerKey): {
  total: number;
  subjects: Record<string, number>;
  validationLevel: ValidationLevel;
} {
  return {
    total: key.total,
    subjects: Object.fromEntries(key.subjects.map((subject) => [subject.id, subject.numbers.length])),
    validationLevel: key.validationLevel,
  };
}

export function referenceQuestionsForKey(
  config: ReferenceProviderConfig,
  key: ReferenceAnswerKey,
): NormalizedQuestion[] {
  const documentUrl = key.examUrl ?? key.answerKeyUrl;

  return Array.from({ length: key.total }, (_, index) => {
    const number = index + 1;
    const subject = subjectOf(key, number);
    const correct = key.annulled.includes(number) ? null : key.answers[String(number)] ?? null;

    return {
      providerId: config.id,
      examId: `${config.id}-${key.edition}-${key.phase}`,
      year: key.year,
      index: number,
      number,
      phase: key.phase,
      language: config.defaultLanguage ?? null,
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
    };
  });
}

export function buildReferenceProvider(config: ReferenceProviderConfig): ExamProvider {
  return {
    id: config.id,
    metadata: config.metadata,
    async fetchQuestions({ year }) {
      const key = referenceAnswerKey(config.keys, year);
      return key ? referenceQuestionsForKey(config, key) : [];
    },
    questionKey(question) {
      return referenceQuestionKey(config.id, question);
    },
  };
}
