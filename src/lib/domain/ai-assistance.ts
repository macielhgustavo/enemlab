import type { StudentAIAssistanceTrace } from "./types";

/**
 * Assistência alta significa que a questão deixou de ser uma evidência limpa de
 * resolução independente. Isso não altera nota, acerto oficial ou TRI.
 */
export function isHighStudentAIAssistance(
  trace?: StudentAIAssistanceTrace,
): boolean {
  return !!trace && (trace.answerRevealed || trace.maxLevel >= 5);
}
