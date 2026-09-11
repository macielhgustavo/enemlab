import type {
  AIAssistanceLevel,
  AIQuestionContext,
  AISemanticHighlight,
} from "./types";

const HIGHLIGHT_LIMIT_BY_LEVEL: Record<AIAssistanceLevel, number> = {
  1: 1,
  2: 3,
  3: 4,
  4: 5,
  5: 6,
  6: 6,
};

/**
 * Normalização somente para conferir se o trecho realmente pertence à questão.
 * Remove decoração comum de Markdown/HTML sem tentar reinterpretar conteúdo.
 */
export function normalizeSemanticText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~#>|]/g, " ")
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function sourceText(question: AIQuestionContext): string {
  return [question.statement, question.alternativesIntroduction]
    .filter((part): part is string => !!part?.trim())
    .join(" ");
}

/**
 * Provider só sugere. O produto aceita uma marcação quando o trecho existe de
 * fato no enunciado/introdução e limita progressivamente a quantidade pela
 * profundidade da assistência.
 */
export function sanitizeSemanticHighlights(
  highlights: AISemanticHighlight[] | undefined,
  question: AIQuestionContext,
  level: AIAssistanceLevel,
): AISemanticHighlight[] | undefined {
  if (!highlights?.length) return undefined;

  const source = normalizeSemanticText(sourceText(question));
  if (!source) return undefined;

  const seen = new Set<string>();
  const accepted: AISemanticHighlight[] = [];

  for (const highlight of highlights) {
    const text = highlight.text.replace(/\s+/g, " ").trim();
    const note = highlight.note.replace(/\s+/g, " ").trim();
    const normalized = normalizeSemanticText(text);

    if (normalized.length < 4 || !note || !source.includes(normalized) || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    accepted.push({ text, role: highlight.role, note });
    if (accepted.length >= HIGHLIGHT_LIMIT_BY_LEVEL[level]) break;
  }

  return accepted.length ? accepted : undefined;
}
