import type { Question } from "../domain/types";
import { eearAcademicMetadata, type StructuralAcademicMetadata } from "./eear";
import { esaAcademicMetadata } from "./esa";
import {
  unesp2026AcademicMetadata,
  type ReviewedAcademicMetadata,
} from "./unesp-2026";

export type { AcademicConfidence, ReviewedAcademicMetadata } from "./unesp-2026";
export type { StructuralAcademicMetadata } from "./eear";

export type AcademicMetadata = ReviewedAcademicMetadata | StructuralAcademicMetadata;

/**
 * Lookup fail-closed de metadado acadêmico revisado/estrutural.
 *
 * Não existe classificação textual aqui. Quando a banca tem uma divisão
 * objetiva e revisada (como CFS/EAGS e ESA geral), usamos essa estrutura
 * mesmo que o enunciado esteja em modo referência. Se não houver mapa
 * confiável, retorna null e o classificador textual legado continua sendo o
 * fallback.
 */
export function academicMetadataForQuestion(
  question: Pick<
    Question,
    "providerId" | "year" | "editionId" | "phase" | "number" | "index"
  >,
): AcademicMetadata | null {
  const number = question.number ?? question.index;
  if (
    question.providerId === "unesp" &&
    question.year === 2026 &&
    (question.phase ?? "first") === "first"
  ) {
    return unesp2026AcademicMetadata(number);
  }

  if (question.providerId === "eear") {
    return eearAcademicMetadata({
      year: question.year,
      editionId: question.editionId,
      phase: question.phase,
      number,
    });
  }

  if (question.providerId === "esa") {
    return esaAcademicMetadata({
      year: question.year,
      phase: question.phase,
      number,
    });
  }

  return null;
}
