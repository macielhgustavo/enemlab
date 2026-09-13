// Provider do IME (Concurso de Admissão ao CFG).
//
// Modo referência, pelo mesmo caminho do ITA — mas por um motivo diferente,
// e a diferença importa para quem for adicionar a próxima prova.
//
// A prova do ITA é digitalizada: zero caractere de texto, uma imagem por
// página. Não há o que extrair.
//
// A do IME **tem** camada de texto. O que a inviabiliza é a matemática: a
// extração quebra 67 frações em três linhas e transforma expoentes em
// dígitos comuns. A questão 20 de 2025-2026 sai como `y = x2 / 2b − b / 2`
// quando a fórmula é y = x²/(2b) − b/2. Reproduzir isso mostraria ao aluno
// uma equação diferente da que caiu.
//
// A lição é que "o PDF tem texto" não basta para decidir. O que decide é se
// o texto **preserva o significado**.

import type {
  ExamMetadata,
  ExamProvider,
  ExamSubject,
  NormalizedQuestion,
} from "../types";
import bruto from "./answer-keys.generated.json";
import {
  getStructuredQuestion,
  withStructuredQuestionContent,
} from "../structuredRegistry";

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

/**
 * Questões objetivas de uma edição, montadas a partir do gabarito.
 *
 * Sem conteúdo nativo aprovado, `statementAvailable` é false e a procedência
 * leva ao PDF. O registry pode enriquecer a questão sem alterar identidade ou
 * gabarito quando houver transcrição validada e reutilização permitida.
 */
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

    const base: NormalizedQuestion = {
      providerId: IME_PROVIDER_ID,
      examId: `ime-${edition}-objective`,
      year: k.year,
      index: n,
      number: n,
      phase: "first",
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
      type: "multiple_choice",
      statementAvailable: false,
      official: { official: true, institution: "IME", documentUrl },
      // Questão anulada não tem gabarito: a correção precisa ignorá-la em vez
      // de contar como erro.
      expectedAnswer: null,
    };

    out.push(
      withStructuredQuestionContent(
        base,
        getStructuredQuestion(IME_PROVIDER_ID, k.year, n, "first"),
        "IME",
      ),
    );
  }

  return out;
}

export const imeMetadata: ExamMetadata = {
  id: IME_PROVIDER_ID,
  label: "Instituto Militar de Engenharia",
  shortLabel: "IME",
  years: imeYears(),
  languages: [],
  // A discursiva existe e está registrada na fonte, mas não é executável
  // aqui: só a objetiva entra nesta wave.
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
