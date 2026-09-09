// Provider do ITA.
//
// Enunciados nativos só aparecem quando foram registrados com proveniência
// oficial verificável no structuredRegistry. Edições ainda não estruturadas
// continuam em modo referência, com gabarito oficial e link para o caderno.
import raw from "./answer-keys.generated.json";
import { getStructuredQuestion } from "../structuredRegistry";
import type {
  ExamMetadata,
  ExamProvider,
  FetchQuestionsParams,
  NormalizedQuestion,
} from "../types";

export const ITA_PROVIDER_ID = "ita";
const BASE = "https://www.vestibular.ita.br/provas";

interface AnswerKey {
  year: number;
  phase: string;
  total: number;
  answers: Record<string, string>;
  annulled: number[];
  subjects: Record<string, [number, number]>;
  source: { official: boolean; institution: string; documentUrl: string };
}

const KEYS = raw as unknown as Record<string, AnswerKey>;

const SUBJECT_LABELS: Record<string, string> = {
  mathematics: "Matemática",
  physics: "Física",
  chemistry: "Química",
  english: "Inglês",
  portuguese: "Português",
};

/** Edições com gabarito verificado, da mais recente para a mais antiga. */
export function itaYears(): number[] {
  return Object.values(KEYS)
    .map((k) => k.year)
    .sort((a, b) => b - a);
}

export function itaAnswerKey(year: number): AnswerKey | null {
  return KEYS[String(year)] ?? null;
}

/** URL oficial da prova da 1ª fase. */
export function itaFirstPhaseUrl(year: number): string {
  return `${BASE}/${year}_fase1.pdf`;
}

/** URLs oficiais das provas da 2ª fase, por matéria. */
const ITA_2F_PORTUGUES_DESDE = 2025;

export function itaSecondPhaseUrls(year: number): { subject: string; label: string; url: string }[] {
  const slugs: [string, string][] = [
    ["matematica", "mathematics"],
    ["fisica", "physics"],
    ["quimica", "chemistry"],
  ];
  if (year >= ITA_2F_PORTUGUES_DESDE) slugs.push(["portugues", "portuguese"]);

  return slugs.map(([slug, subject]) => ({
    subject,
    label: SUBJECT_LABELS[subject] ?? subject,
    url: `${BASE}/${slug}_${year}_2f.pdf`,
  }));
}

function subjectOf(key: AnswerKey, number: number): string {
  for (const [name, [lo, hi]] of Object.entries(key.subjects)) {
    if (number >= lo && number <= hi) return name;
  }
  return "unknown";
}

const LETTERS = ["A", "B", "C", "D", "E"];

/** Chave estável e sem colisão com o ENEM (que usa `ano-indice-idioma-area`). */
export function itaQuestionKey(year: number, phase: string, number: number): string {
  return `ita-${year}-${phase}-${number}`;
}

export const itaMetadata: ExamMetadata = {
  id: ITA_PROVIDER_ID,
  label: "Instituto Tecnológico de Aeronáutica",
  shortLabel: "ITA",
  years: itaYears(),
  languages: [{ id: "ingles", label: "Inglês" }],
  phases: ["first", "second"],
  hasEssay: false,
  areas: Object.entries(SUBJECT_LABELS).map(([id, label]) => ({ id, label })),
};

/**
 * Monta as questões objetivas da 1ª fase. Conteúdo nativo é um enriquecimento
 * opcional e só é usado quando o registry garante proveniência + revisão.
 */
export function itaFirstPhaseQuestions(year: number): NormalizedQuestion[] {
  const key = itaAnswerKey(year);
  if (!key) return [];
  const documentUrl = itaFirstPhaseUrl(year);

  const out: NormalizedQuestion[] = [];
  for (let n = 1; n <= key.total; n++) {
    const annulled = key.annulled.includes(n);
    const correct = annulled ? null : (key.answers[String(n)] ?? null);
    const subject = subjectOf(key, n);
    const struct = getStructuredQuestion(ITA_PROVIDER_ID, year, n, "first");

    out.push({
      providerId: ITA_PROVIDER_ID,
      examId: `ita-${year}-first`,
      year,
      index: n,
      number: n,
      phase: "first",
      language: subject === "english" ? "ingles" : null,
      subject: { id: subject, label: SUBJECT_LABELS[subject] ?? subject, area: subject },
      content:
        struct?.statement ??
        `[Questão ${n} - ${SUBJECT_LABELS[subject] ?? subject}] Consulte o caderno de prova oficial para o enunciado completo.`,
      context: struct?.context ?? null,
      alternativesIntroduction: null,
      alternatives: LETTERS.map((letter) => {
        const altStruct = struct?.alternatives.find((alternative) => alternative.letter === letter);
        return {
          letter,
          text: altStruct?.text ?? null,
          file: null,
          isCorrect: correct === letter,
        };
      }),
      correctAlternative: correct,
      files: [],
      sources: [],
      type: "multiple_choice",
      statementAvailable: Boolean(struct),
      official: { official: true, institution: "ITA", documentUrl },
      expectedAnswer: null,
    });
  }
  return out;
}

export const itaProvider: ExamProvider = {
  id: ITA_PROVIDER_ID,
  metadata: itaMetadata,
  async fetchQuestions({ year }: FetchQuestionsParams) {
    return itaFirstPhaseQuestions(year);
  },
  questionKey(q: NormalizedQuestion) {
    return itaQuestionKey(q.year, q.phase, q.number ?? q.index);
  },
};
