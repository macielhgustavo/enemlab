export type NativeExtractionMethod = "text-layer" | "ocr" | "vision" | "manual";
export type NativeReviewStatus = "draft" | "review" | "approved" | "published";
export type NativeVisualRole = "question" | "shared-context" | "continuation" | "figure";
export type NativeVisualCompletenessStrategy =
  | "not-required"
  | "question-region"
  | "shared-context"
  | "continuation"
  | "manual";

/** Coordenadas normalizadas (0..1), independentes da resolução do WebP. */
export interface NativeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Uma prova é rasterizada uma vez por página. Questões guardam somente os
 * recortes que a UI deve mostrar. `assetPath` é um derivado opcional gerado
 * na publicação para o runner carregar sem precisar recortar no navegador.
 * A fonte canônica continua sendo página + coordenadas.
 */
export interface NativeVisualRegion {
  page: number;
  rect: NativeRect;
  role: NativeVisualRole;
  assetPath?: string;
}

export interface NativeDocumentRecord {
  documentId: string;
  providerId: string;
  year: number;
  editionId?: string;
  phase: string;
  sourceUrl: string;
  sourceSha256: string;
  sourceBytes: number;
  pageCount: number;
  /** Ex.: native/unesp/2026/first/<sha>/page-{page}.webp */
  pageAssetPattern: string;
  renderScale: number;
  imageFormat: "webp";
}

export interface NativeSemanticAlternative {
  letter: string;
  text: string;
}

export interface NativeSemanticContent {
  /** Texto semântico para busca/classificação. A imagem continua canônica. */
  context?: string;
  alternativesIntroduction?: string;
  alternatives?: NativeSemanticAlternative[];
  rawText?: string;
}

/**
 * Evidência explícita de que o recorte contém tudo que a questão precisa.
 * O pipeline v2 usa isso para diferenciar um recorte meramente válido de um
 * recorte pedagogicamente completo (contexto compartilhado, figura, continuação etc.).
 */
export interface NativeVisualCompletenessEvidence {
  required: boolean;
  resolved: boolean;
  reasons: string[];
  strategy: NativeVisualCompletenessStrategy;
}

export interface NativeExtractionEvidence {
  method: NativeExtractionMethod;
  parserVersion: string;
  confidence: number;
  markerDetected: boolean;
  optionIdsDetected: string[];
  issues: string[];
  visualCompleteness?: NativeVisualCompletenessEvidence;
}

export interface NativeQuestionContentRecord {
  questionKey: string;
  providerId: string;
  year: number;
  editionId?: string;
  phase: string;
  number: number;
  documentId: string;
  visualRegions: NativeVisualRegion[];
  semantic: NativeSemanticContent;
  extraction: NativeExtractionEvidence;
  /**
   * draft/review = ainda não aprovado; approved = revisão concluída (manual
   * ou em massa para itens sem risco); published = publisher concluiu a etapa.
   */
  status: NativeReviewStatus;
}

export interface NativePack {
  version: 1;
  createdAt: string;
  documents: NativeDocumentRecord[];
  questions: NativeQuestionContentRecord[];
}

function normalized(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validRect(rect: NativeRect): boolean {
  return (
    normalized(rect.x) &&
    normalized(rect.y) &&
    normalized(rect.width) &&
    normalized(rect.height) &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= 1.000001 &&
    rect.y + rect.height <= 1.000001
  );
}

function isPipelineV2(parserVersion: string): boolean {
  const match = /^native-pipeline@(\d+)(?:\.|$)/.exec(parserVersion);
  return !!match && Number(match[1]) >= 2;
}

export interface NativePublicationGate {
  publishable: boolean;
  issues: string[];
}

/**
 * Gate fail-closed. O visual pode ser publicado sem OCR perfeito, mas nunca
 * sem identidade, fonte fingerprintada, regiões válidas e, no pipeline v2,
 * evidência explícita de completude visual.
 */
export function nativePublicationGate(
  question: NativeQuestionContentRecord,
  document: NativeDocumentRecord | undefined,
): NativePublicationGate {
  const issues: string[] = [];
  if (!document) issues.push("documento nativo ausente");
  if (!question.questionKey.trim()) issues.push("questionKey ausente");
  if (!Number.isInteger(question.number) || question.number < 1) issues.push("número inválido");
  if (!question.visualRegions.length) issues.push("sem região visual");
  if (question.visualRegions.some((region) => !validRect(region.rect) || region.page < 1)) {
    issues.push("região visual inválida");
  }
  if (!question.extraction.markerDetected) issues.push("marcador da questão não confirmado");
  if (
    !Number.isFinite(question.extraction.confidence) ||
    question.extraction.confidence < 0 ||
    question.extraction.confidence > 1
  ) {
    issues.push("confiança de extração inválida");
  }

  const completeness = question.extraction.visualCompleteness;
  if (isPipelineV2(question.extraction.parserVersion) && !completeness) {
    issues.push("pipeline v2 sem evidência de completude visual");
  }
  if (completeness) {
    if (
      typeof completeness.required !== "boolean" ||
      typeof completeness.resolved !== "boolean" ||
      !Array.isArray(completeness.reasons)
    ) {
      issues.push("evidência de completude visual inválida");
    } else if (completeness.required && !completeness.resolved) {
      issues.push("dependência visual/contextual não resolvida");
    }
    if (
      completeness.strategy === "shared-context" &&
      !question.visualRegions.some((region) => region.role === "shared-context")
    ) {
      issues.push("contexto compartilhado declarado sem região correspondente");
    }
    if (
      completeness.strategy === "continuation" &&
      !question.visualRegions.some((region) => region.role === "continuation")
    ) {
      issues.push("continuação declarada sem região correspondente");
    }
  }

  if (document) {
    if (!/^[0-9a-f]{64}$/i.test(document.sourceSha256)) issues.push("SHA-256 da fonte inválido");
    if (!Number.isFinite(document.sourceBytes) || document.sourceBytes <= 0) {
      issues.push("tamanho da fonte inválido");
    }
    if (!Number.isInteger(document.pageCount) || document.pageCount < 1) {
      issues.push("quantidade de páginas inválida");
    }
    if (!Number.isFinite(document.renderScale) || document.renderScale <= 0) {
      issues.push("escala de renderização inválida");
    }
    if (question.documentId !== document.documentId) issues.push("documentId divergente");
    if (question.providerId !== document.providerId) issues.push("providerId divergente");
    if (question.year !== document.year) issues.push("ano divergente");
    if ((question.editionId ?? undefined) !== (document.editionId ?? undefined)) {
      issues.push("editionId divergente");
    }
    if (question.phase !== document.phase) issues.push("fase divergente");
    if (question.visualRegions.some((region) => region.page > document.pageCount)) {
      issues.push("região aponta para página inexistente");
    }
  }
  return { publishable: issues.length === 0, issues };
}
