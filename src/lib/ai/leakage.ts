import type { AIProviderOutput, AIQuestionContext } from "./types";

export type AnswerLeakKind =
  | "explicit-answer"
  | "correct-option-text"
  | "elimination";

export interface AnswerLeakMatch {
  kind: AnswerLeakKind;
}

const SAFE_TITLE = "Pista de raciocínio";
const SAFE_EXPLANATION =
  "A resposta gerada se aproximou demais do gabarito. Volte ao enunciado, identifique o conceito central e relacione os dados antes de escolher uma alternativa.";
const SAFE_NEXT_STEP =
  "Explique com suas palavras qual relação entre os dados você precisa testar antes de marcar uma alternativa.";
const SAFE_DIAGNOSTIC_NOTE =
  "Há indícios na alternativa marcada; revise o raciocínio usado antes de concluir.";
const SAFE_HIGHLIGHT_NOTE =
  "Este trecho é relevante para organizar o raciocínio sem antecipar o gabarito.";

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[“”"'`*_~]/g, "")
    .replace(/\s*([%$€=+\-×÷/])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function correctAlternative(question: AIQuestionContext) {
  const letter = question.correctAnswer?.trim().toUpperCase();
  if (!letter) return undefined;
  return question.alternatives.find(
    (alternative) => alternative.letter.trim().toUpperCase() === letter,
  );
}

function hasDistinctiveCorrectOptionText(
  text: string,
  question: AIQuestionContext,
): boolean {
  const correct = correctAlternative(question);
  if (!correct?.text?.trim()) return false;

  const option = normalizeForMatch(correct.text);
  if (!option || /^[a-e]$/i.test(option)) return false;

  const compact = option.replace(/\s+/g, "");
  const wordCount = option.split(" ").filter(Boolean).length;
  const distinctive =
    (/\d/.test(option) && compact.length >= 2) ||
    option.length >= 5 ||
    wordCount >= 2;
  if (!distinctive) return false;

  return normalizeForMatch(text).includes(option);
}

function hasExplicitCorrectAnswer(text: string, question: AIQuestionContext): boolean {
  const correctLetter = question.correctAnswer?.trim().toLowerCase();
  if (!correctLetter) return false;

  const body = normalizeForMatch(text);
  const letter = escapeRegex(correctLetter);
  const choice = "(?:alternativa|opcao|letra)";
  const patterns = [
    new RegExp(`\\bgabarito\\s*(?:e|:|-)??\\s*(?:${choice}\\s+)?${letter}\\b`, "i"),
    new RegExp(
      `\\bresposta\\s+correta\\s*(?:e|:|-)??\\s*(?:a\\s+)?(?:${choice}\\s+)?${letter}\\b`,
      "i",
    ),
    new RegExp(
      `\\bresposta\\s*(?:e|:|-)\\s*(?:a\\s+)?(?:${choice}\\s+)?${letter}\\b`,
      "i",
    ),
    new RegExp(`\\b${choice}\\s+${letter}\\s+(?:e|esta)\\s+(?:a\\s+)?correta\\b`, "i"),
    new RegExp(
      `\\b(?:a\\s+)?correta\\s+(?:e|seria)\\s+(?:a\\s+)?(?:${choice}\\s+)?${letter}\\b`,
      "i",
    ),
    new RegExp(
      `\\b(?:marque|assinale|escolha)\\s+(?:a\\s+)?(?:${choice}\\s+)?${letter}\\b`,
      "i",
    ),
  ];

  return patterns.some((pattern) => pattern.test(body));
}

function explicitlyRejectsAlternative(text: string, letter: string): boolean {
  const body = normalizeForMatch(text);
  const escapedLetter = escapeRegex(letter.toLowerCase());
  const choice = `(?:alternativa|opcao|letra)\\s+${escapedLetter}`;
  const rejection =
    "(?:errad[ao]|incorret[ao]|fals[ao]|nao serve|nao se aplica|nao faz sentido|deve ser descartad[ao])";

  return (
    new RegExp(`\\b${choice}\\b.{0,36}\\b${rejection}\\b`, "i").test(body) ||
    new RegExp(`\\b${rejection}\\b.{0,36}\\b${choice}\\b`, "i").test(body)
  );
}

function revealsByElimination(text: string, question: AIQuestionContext): boolean {
  const correctLetter = question.correctAnswer?.trim().toUpperCase();
  if (!correctLetter || question.alternatives.length < 2) return false;

  const wrongAlternatives = question.alternatives.filter(
    (alternative) => alternative.letter.trim().toUpperCase() !== correctLetter,
  );
  if (!wrongAlternatives.length) return false;

  const rejected = wrongAlternatives.filter((alternative) =>
    explicitlyRejectsAlternative(text, alternative.letter),
  ).length;

  return rejected >= question.alternatives.length - 1;
}

export function detectAnswerLeak(
  text: string | undefined,
  question: AIQuestionContext,
): AnswerLeakMatch[] {
  if (!text?.trim() || !question.correctAnswer) return [];

  const matches: AnswerLeakMatch[] = [];
  if (hasExplicitCorrectAnswer(text, question)) {
    matches.push({ kind: "explicit-answer" });
  }
  if (hasDistinctiveCorrectOptionText(text, question)) {
    matches.push({ kind: "correct-option-text" });
  }
  if (revealsByElimination(text, question)) {
    matches.push({ kind: "elimination" });
  }
  return matches;
}

export function hasAnswerLeak(
  text: string | undefined,
  question: AIQuestionContext,
): boolean {
  return detectAnswerLeak(text, question).length > 0;
}

function safeText(
  text: string | undefined,
  question: AIQuestionContext,
  fallback: string,
): string | undefined {
  if (text === undefined) return undefined;
  return hasAnswerLeak(text, question) ? fallback : text;
}

/**
 * Segunda fronteira pedagógica, aplicada depois do provider.
 * O prompt reduz a chance de vazamento; este guard impede que texto livre
 * entregue o gabarito antes do nível 6 mesmo quando o modelo ignora o prompt.
 */
export function sanitizeProviderOutputForLeaks(
  raw: AIProviderOutput,
  question: AIQuestionContext,
  allowAnswerReveal: boolean,
): AIProviderOutput {
  if (allowAnswerReveal || !question.correctAnswer) return raw;

  return {
    ...raw,
    title: safeText(raw.title, question, SAFE_TITLE) || SAFE_TITLE,
    explanation:
      safeText(raw.explanation, question, SAFE_EXPLANATION) || SAFE_EXPLANATION,
    concepts: raw.concepts.filter((concept) => !hasAnswerLeak(concept, question)),
    nextStep: safeText(raw.nextStep, question, SAFE_NEXT_STEP) || SAFE_NEXT_STEP,
    revealAnswer: false,
    answer: undefined,
    diagnostic: raw.diagnostic
      ? {
          ...raw.diagnostic,
          note:
            safeText(raw.diagnostic.note, question, SAFE_DIAGNOSTIC_NOTE) ||
            SAFE_DIAGNOSTIC_NOTE,
        }
      : undefined,
    highlights: raw.highlights?.map((highlight) => ({
      ...highlight,
      note:
        safeText(highlight.note, question, SAFE_HIGHLIGHT_NOTE) ||
        SAFE_HIGHLIGHT_NOTE,
    })),
    generatedQuestion: raw.generatedQuestion
      ? {
          ...raw.generatedQuestion,
          explanation: hasAnswerLeak(raw.generatedQuestion.explanation, question)
            ? undefined
            : raw.generatedQuestion.explanation,
        }
      : undefined,
  };
}
