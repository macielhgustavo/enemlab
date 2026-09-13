import type { Question } from "../domain/types";
import {
  unesp2026AcademicMetadata,
  type ReviewedAcademicMetadata,
} from "./unesp-2026";

export type { AcademicConfidence, ReviewedAcademicMetadata } from "./unesp-2026";

/**
 * Lookup fail-closed de metadado acadêmico revisado.
 *
 * Não existe heurística aqui: se uma edição ainda não possui um mapa
 * revisado, retorna null e o classificador textual continua sendo o fallback.
 */
export function academicMetadataForQuestion(
  question: Pick<Question, "providerId" | "year" | "phase" | "number" | "index">,
): ReviewedAcademicMetadata | null {
  const number = question.number ?? question.index;
  if (
    question.providerId === "unesp" &&
    question.year === 2026 &&
    (question.phase ?? "first") === "first"
  ) {
    return unesp2026AcademicMetadata(number);
  }
  return null;
}
