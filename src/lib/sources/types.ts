// Camada de FONTE — separada do provider de execução.
//
// Provider responde "como o ENEM Lab usa esta prova".
// Fonte responde "de onde este conteúdo vem, em que forma, e o que podemos
// fazer com ele". Misturar os dois foi o que deixou o ENEM embutido no app.
//
//   FONTE → IMPORTADOR → CATÁLOGO NORMALIZADO → PROVIDER

/** Formato em que a fonte publica o conteúdo. */
export type SourceType =
  | "structured-api"
  | "official-html"
  | "pdf-text"
  | "pdf-reference"
  | "partner-feed"
  | "open-dataset";

/** Como o enunciado chega até o aluno. */
export type StatementMode = "structured" | "reference-only" | "mixed";

/**
 * Situação operacional de reuso. **Não é parecer jurídico** — é um marcador
 * para sabermos o que ainda precisa ser checado antes de distribuir conteúdo.
 */
export type ReuseStatus =
  | "allowed"
  | "official-reference"
  | "permission-required"
  | "unknown";

/** Como o conteúdo foi extraído da fonte. */
export type ExtractionMethod =
  | "api"
  | "html-parse"
  | "pdf-text-layer"
  | "manual"
  | "none";

export interface ExamSourceDefinition {
  id: string;
  /** Provider de execução que consome esta fonte. */
  providerId: string;
  institution: string;
  /** Página oficial onde as provas são publicadas. */
  archiveUrl: string;
  sourceType: SourceType;
  statementMode: StatementMode;
  extractionMethod: ExtractionMethod;
  reuseStatus: ReuseStatus;

  /** Edições que a ingestão validou — não as que a fonte publica. */
  years: number[];
  phases: string[];
  subjects: string[];

  answerKeyAvailable: boolean;
  expectedAnswersAvailable: boolean;

  parserVersion: string;
  /** Data da última verificação real contra a fonte. */
  lastVerifiedAt: string;
  /** Confiança na ingestão, do que foi de fato conferido. */
  confidence: "alta" | "media" | "baixa";
  /** O que um leitor precisa saber antes de confiar nestes dados. */
  notes?: string;
}

/** Procedência de um item: responde "de onde veio isto?". */
export interface Provenance {
  providerId: string;
  sourceId: string;
  institution: string;
  official: boolean;
  documentUrl: string;
  page?: number;
  parserVersion: string;
  lastVerifiedAt: string;
}

/**
 * Um importador descobre e normaliza o conteúdo de uma fonte. O ENEM usa a
 * API estruturada; o ITA usa o gabarito em PDF. Nenhum dos dois é conhecido
 * pelas telas.
 */
export interface ExamImporter {
  readonly sourceId: string;
  /** Edições disponíveis segundo a ingestão já verificada. */
  availableYears(): number[];
  /** Procedência de um item específico. */
  provenanceFor(year: number, phase?: string, page?: number): Provenance;
}
