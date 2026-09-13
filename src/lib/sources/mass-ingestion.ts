import { eearYears } from "../providers/eear";
import { fatecYears } from "../providers/fatec";
import { unespYears } from "../providers/unesp";
import { unioesteYears } from "../providers/unioeste";
import type { ExamSourceDefinition } from "./types";

export const eearMassSource: ExamSourceDefinition = {
  id: "eear-corpus-reference",
  providerId: "eear",
  institution: "EEAR/FAB",
  archiveUrl: "https://ingresso.eear.fab.mil.br/SOO/home/provas_anteriores.php?sigla_conc=%25",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "permission-required",
  status: "active",
  family: "air-force",
  discovery: "manual",
  years: eearYears(),
  phases: ["single"],
  subjects: ["portuguese", "mathematics", "physics", "english", "conhecimentos-especificos"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: "eear-corpus-reference@1.0.0",
  lastVerifiedAt: "2026-09-12",
  confidence: "media",
  notes:
    "Edições normalizadas a partir do corpus auditado. Os bytes usados são espelhos públicos " +
    "de documentos identificados como gabaritos EEAR; espelho continua marcado como não oficial " +
    "e cada edição preserva SHA-256/tamanho. Códigos da mesma aplicação são variantes, não novas edições.",
};

export const fatecMassSource: ExamSourceDefinition = {
  id: "fatec-official-archive",
  providerId: "fatec",
  institution: "Centro Paula Souza/FATEC",
  archiveUrl: "https://vestibular.fatec.sp.gov.br/provas-gabaritos/",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  status: "active",
  family: "university",
  discovery: "manual",
  years: fatecYears(),
  phases: ["single"],
  subjects: ["conhecimentos-gerais"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: "fatec-official-reference@1.0.0",
  lastVerifiedAt: "2026-09-12",
  confidence: "media",
  notes:
    "O arquivo oficial associa prova e gabarito final/retificado. As edições ficam reviewed, " +
    "não verified, enquanto o fingerprint local dos PDFs oficiais não estiver completo.",
};

export const unespMassSource: ExamSourceDefinition = {
  id: "unesp-vunesp-reference",
  providerId: "unesp",
  institution: "UNESP/VUNESP",
  archiveUrl: "https://www.vunesp.com.br/VNSP2504",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "permission-required",
  status: "active",
  family: "university",
  discovery: "manual",
  years: unespYears(),
  phases: ["first"],
  subjects: ["conhecimentos-gerais"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: "unesp-corpus-reference@1.0.0",
  lastVerifiedAt: "2026-09-12",
  confidence: "media",
  notes:
    "A autoridade canônica é a VUNESP, mas os bytes executados nesta edição vêm de espelhos " +
    "públicos. O gabarito espelhado foi conferido contra o documento canônico e os hashes são preservados.",
};

export const unioesteMassSource: ExamSourceDefinition = {
  id: "unioeste-official-archive",
  providerId: "unioeste",
  institution: "UNIOESTE",
  archiveUrl: "https://www.unioeste.br/portal/vestibular/anteriores/82161-cadernos-de-prova",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  status: "active",
  family: "university",
  discovery: "manual",
  years: unioesteYears(),
  phases: ["morning", "afternoon"],
  subjects: ["english", "portuguese", "literature", "geography", "history", "philosophy", "sociology", "biology", "physics", "mathematics", "chemistry"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: "unioeste-reference@1.0.0",
  lastVerifiedAt: "2026-09-12",
  confidence: "alta",
  notes:
    "Cadernos e gabaritos definitivos do arquivo oficial. Manhã e tarde são sessões reais; " +
    "a versão de Inglês é a canônica da manhã para não duplicar identidade com Espanhol.",
};

export const MASS_INGESTION_SOURCES: ExamSourceDefinition[] = [
  eearMassSource,
  fatecMassSource,
  unespMassSource,
  unioesteMassSource,
];
