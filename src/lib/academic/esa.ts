import type { StructuralAcademicMetadata } from "./eear";

interface Range {
  from: number;
  to: number;
  area: string;
  discipline: string;
  topic: string;
}

const ESA_GENERAL_RANGES: Range[] = [
  { from: 1, to: 14, area: "matematica", discipline: "Matemática", topic: "Matemática" },
  { from: 15, to: 28, area: "linguagens", discipline: "Língua Portuguesa", topic: "Língua Portuguesa" },
  {
    from: 29,
    to: 40,
    area: "ciencias-humanas",
    discipline: "História e Geografia do Brasil",
    topic: "História e Geografia do Brasil",
  },
  { from: 41, to: 50, area: "linguagens", discipline: "Língua Inglesa", topic: "Língua Inglesa" },
];

/**
 * Estrutura da prova da área geral já codificada e validada no provider ESA.
 * Mantemos o nível de matéria; subtópicos exigem revisão do enunciado.
 */
export function esaAcademicMetadata(input: {
  year: number;
  phase?: string;
  number: number;
}): StructuralAcademicMetadata | null {
  const range = ESA_GENERAL_RANGES.find(
    (candidate) => input.number >= candidate.from && input.number <= candidate.to,
  );
  if (!range) return null;
  return {
    providerId: "esa",
    year: input.year,
    phase: input.phase ?? "single",
    number: input.number,
    area: range.area,
    discipline: range.discipline,
    topic: range.topic,
    subtopic: null,
    confidence: "alta",
    reviewedAt: "2026-09-13T00:00:00-03:00",
    evidence: "faixas de matéria codificadas e validadas no provider ESA — área geral",
  };
}
