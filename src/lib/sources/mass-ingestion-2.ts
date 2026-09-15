import { MASS2_BUNDLES, MASS2_PROVIDER_SPECS } from "../providers/mass2";
import type { ExamSourceDefinition } from "./types";

const PARSER_VERSION = "mass2-sparky@1.0.0";

export const MASS_INGESTION_2_SOURCES: ExamSourceDefinition[] =
  MASS2_PROVIDER_SPECS.map((spec) => ({
    id: `${spec.id}-redistributed-reference`,
    providerId: spec.id,
    institution: spec.institution,
    archiveUrl: spec.archiveUrl,
    sourceType: "pdf-reference",
    statementMode: "reference-only",
    extractionMethod: "pdf-text-layer",
    rightsStatus: "permission-required",
    status: "active",
    family: "university",
    discovery: "automatic",
    years: MASS2_BUNDLES[spec.id].years,
    phases: MASS2_BUNDLES[spec.id].metadata.phases,
    subjects: ["conhecimentos-gerais"],
    answerKeyAvailable: true,
    expectedAnswersAvailable: false,
    parserVersion: PARSER_VERSION,
    lastVerifiedAt: "2026-09-15",
    confidence: "alta",
    notes:
      "Mass Ingestion 2 / Sparky: índice público de provas já redistribuídas usado " +
      "somente como referência externa. O bundle não copia enunciados nem PDFs; " +
      "armazena metadata e gabaritos factuais. Cada edição promovida exige resposta " +
      "única A-D/A-E, cobertura completa e fingerprint do PDF de gabarito. Direitos " +
      "de republicação não são presumidos.",
  }));
