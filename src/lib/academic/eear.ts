import type { AcademicConfidence } from "./unesp-2026";

export interface StructuralAcademicMetadata {
  providerId: string;
  year: number;
  phase: string;
  number: number;
  area: string;
  discipline: string;
  topic: string;
  subtopic: string | null;
  difficulty?: "facil" | "media" | "dificil";
  confidence: AcademicConfidence;
  reviewedAt: string;
  evidence: string;
}

interface Range {
  from: number;
  to: number;
  area: string;
  discipline: string;
  topic: string;
}

const CFS_RANGES: Range[] = [
  { from: 1, to: 24, area: "linguagens", discipline: "Língua Portuguesa", topic: "Língua Portuguesa" },
  { from: 25, to: 48, area: "matematica", discipline: "Matemática", topic: "Matemática" },
  { from: 49, to: 72, area: "ciencias-natureza", discipline: "Física", topic: "Física" },
  { from: 73, to: 96, area: "linguagens", discipline: "Língua Inglesa", topic: "Língua Inglesa" },
];

const EAGS_RANGES: Range[] = [
  { from: 1, to: 40, area: "linguagens", discipline: "Língua Portuguesa", topic: "Língua Portuguesa" },
  {
    from: 41,
    to: 100,
    area: "conhecimentos-especificos",
    discipline: "Conhecimentos específicos",
    topic: "Conhecimentos específicos",
  },
];

const REVIEWED_AT = "2026-09-13T00:00:00-03:00";

/**
 * A EEAR publica cadernos com estrutura fixa por modalidade. Este mapa não
 * tenta inferir subtópico pelo enunciado: usa apenas as faixas que o próprio
 * provider já validou ao ingerir CFS/EAGS.
 */
export function eearAcademicMetadata(input: {
  year: number;
  editionId?: string;
  phase?: string;
  number: number;
}): StructuralAcademicMetadata | null {
  const editionId = input.editionId ?? "";
  const ranges = editionId.includes("-cfs-")
    ? CFS_RANGES
    : editionId.includes("-eags")
      ? EAGS_RANGES
      : null;
  if (!ranges) return null;

  const range = ranges.find((candidate) => input.number >= candidate.from && input.number <= candidate.to);
  if (!range) return null;

  return {
    providerId: "eear",
    year: input.year,
    phase: input.phase ?? "single",
    number: input.number,
    area: range.area,
    discipline: range.discipline,
    topic: range.topic,
    subtopic: null,
    confidence: "alta",
    reviewedAt: REVIEWED_AT,
    evidence: `faixa estrutural ${editionId.includes("-cfs-") ? "CFS" : "EAGS"} validada pelo provider EEAR`,
  };
}
