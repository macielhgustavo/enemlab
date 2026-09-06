// Registry de fontes de prova.
import { itaYears, itaFirstPhaseUrl, itaSecondPhaseUrls } from "../providers/ita";
import { examYears } from "../domain/constants";
import type { ExamImporter, ExamSourceDefinition, Provenance } from "./types";

export * from "./types";

const ITA_PARSER = "ita-answer-key@1.0.0";
const ENEM_PARSER = "enem-dev-api@1.0.0";

/**
 * ENEM: API estruturada, com enunciado e alternativas em texto.
 */
export const enemSource: ExamSourceDefinition = {
  id: "enem-dev",
  providerId: "enem",
  institution: "INEP",
  archiveUrl: "https://api.enem.dev",
  sourceType: "structured-api",
  statementMode: "structured",
  extractionMethod: "api",
  reuseStatus: "allowed",
  years: examYears(),
  phases: ["day1", "day2"],
  subjects: ["matematica", "ciencias-natureza", "ciencias-humanas", "linguagens"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: ENEM_PARSER,
  lastVerifiedAt: "2026-09-05",
  confidence: "alta",
  notes: "Provas do INEP são de acesso público e a API entrega conteúdo estruturado.",
};

/**
 * ITA: arquivo oficial em PDF. As provas são digitalizadas (verificado: 0
 * caractere de texto, uma imagem por página), então o enunciado permanece na
 * fonte. Só o gabarito é ingerido, por ter camada de texto e ser dado factual.
 */
export const itaSource: ExamSourceDefinition = {
  id: "ita-official-archive",
  providerId: "ita",
  institution: "ITA",
  archiveUrl: "https://www.vestibular.ita.br/provas.htm",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  reuseStatus: "official-reference",
  years: itaYears(),
  phases: ["first", "second"],
  subjects: ["mathematics", "physics", "chemistry", "portuguese", "english"],
  answerKeyAvailable: true,
  // O ITA não publica resolução oficial estruturada da 2ª fase.
  expectedAnswersAvailable: false,
  parserVersion: ITA_PARSER,
  lastVerifiedAt: "2026-09-05",
  confidence: "alta",
  notes:
    "Enunciado não é reproduzido: é consultado no PDF oficial. Edições até 2018 " +
    "numeram por matéria e foram recusadas pela ingestão.",
};

const SOURCES = new Map<string, ExamSourceDefinition>([
  [enemSource.id, enemSource],
  [itaSource.id, itaSource],
]);

export function listSources(): ExamSourceDefinition[] {
  return [...SOURCES.values()];
}

export function getSource(id: string): ExamSourceDefinition {
  const s = SOURCES.get(id);
  if (!s) throw new Error(`Fonte não registrada: ${id}`);
  return s;
}

/** Fontes que alimentam um provider. */
export function sourcesForProvider(providerId: string): ExamSourceDefinition[] {
  return listSources().filter((s) => s.providerId === providerId);
}

function provenance(src: ExamSourceDefinition, documentUrl: string, page?: number): Provenance {
  return {
    providerId: src.providerId,
    sourceId: src.id,
    institution: src.institution,
    official: src.reuseStatus !== "unknown",
    documentUrl,
    page,
    parserVersion: src.parserVersion,
    lastVerifiedAt: src.lastVerifiedAt,
  };
}

export const itaImporter: ExamImporter = {
  sourceId: itaSource.id,
  availableYears: () => itaYears(),
  provenanceFor(year, phase = "first", page) {
    // A 2ª fase é dividida por matéria; sem matéria, aponta o arquivo do ano.
    const url =
      phase === "second"
        ? (itaSecondPhaseUrls(year)[0]?.url ?? itaFirstPhaseUrl(year))
        : itaFirstPhaseUrl(year);
    return provenance(itaSource, url, page);
  },
};

export const enemImporter: ExamImporter = {
  sourceId: enemSource.id,
  availableYears: () => examYears(),
  provenanceFor(year) {
    return provenance(enemSource, `${enemSource.archiveUrl}/v1/exams/${year}/questions`);
  },
};

export function importerForProvider(providerId: string): ExamImporter | null {
  if (providerId === "ita") return itaImporter;
  if (providerId === "enem") return enemImporter;
  return null;
}
