import type {
  StudentAIAssistanceTrace,
  StudentAIDiagnosticCategory,
} from "./types";

/**
 * Assistência alta significa que a questão deixou de ser uma evidência limpa de
 * resolução independente. Isso não altera nota, acerto oficial ou TRI.
 */
export function isHighStudentAIAssistance(
  trace?: StudentAIAssistanceTrace,
): boolean {
  return !!trace && (trace.answerRevealed || trace.maxLevel >= 5);
}

/**
 * Somente diagnósticos de alta confiança entram nos motores adaptativos.
 * O texto explicativo do LLM não é persistido nem usado como dado de decisão.
 */
export function latestHighConfidenceStudentAIDiagnostic(
  trace?: StudentAIAssistanceTrace,
): StudentAIDiagnosticCategory | null {
  if (!trace?.recent?.length) return null;
  for (let index = trace.recent.length - 1; index >= 0; index--) {
    const diagnostic = trace.recent[index].diagnostic;
    if (diagnostic?.confidence === "high" && diagnostic.category !== "unknown") {
      return diagnostic.category;
    }
  }
  return null;
}

/**
 * Peso pequeno e limitado para o Adaptive. É um bônus de investigação, não uma
 * ordem do LLM; desempenho real, SRS, recência e diversidade continuam mandando.
 */
export function studentAIDiagnosticAdaptiveWeight(
  category: StudentAIDiagnosticCategory | null,
): number {
  if (category === "content-gap") return 8;
  if (category === "calculation") return 6;
  if (category === "interpretation") return 5;
  if (category === "strategy") return 5;
  if (category === "attention") return 2;
  return 0;
}

/**
 * Para encurtar uma revisão SRS exigimos dois sinais simultâneos: assistência
 * alta e diagnóstico de alta confiança associado a aprendizagem/estratégia.
 */
export function shouldReinforceSRSFromStudentAI(
  trace?: StudentAIAssistanceTrace,
): boolean {
  if (!isHighStudentAIAssistance(trace)) return false;
  const category = latestHighConfidenceStudentAIDiagnostic(trace);
  return (
    category === "content-gap" ||
    category === "calculation" ||
    category === "interpretation" ||
    category === "strategy"
  );
}
