export type NativeExtractionMethod = "text-layer" | "ocr" | "vision" | "manual";
export type NativeReviewStatus = "draft" | "review" | "approved" | "published";
export type NativeVisualRole = "question" | "shared-context" | "continuation" | "figure";

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

export interface NativeExtractionEvidence {
  method: NativeExtractionMethod;
  parserVersion: string;
  confidence: number;
  markerDetected: boolean;
  optionIdsDetected: string[];
  issues: string[];
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
   * draft/review = ainda não aprovado; approved = revisão humana concluída;
   * published = o publisher concluiu a publicação do pack.
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

export interface NativePublicationGate {
  publishable: boolean;
  issues: string[];
}

/**
 * Gate fail-closed. O visual pode ser publicado sem OCR perfeito, mas nunca
 * sem identidade, fonte fingerprintada e um recorte visual válido.
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
  if (document) {
    if (!/^[0-9a-f]{64}$/i.test(document.sourceSha256)) issues.push("SHA-256 da fonte inválido");
    if (document.sourceBytes <= 0) issues.push("tamanho da fonte inválido");
    if (question.documentId !== document.documentId) issues.push("documentId divergente");
    if (question.visualRegions.some((region) => region.page > document.pageCount)) {
      issues.push("região aponta para página inexistente");
    }
  }
  return { publishable: issues.length === 0, issues };
}
