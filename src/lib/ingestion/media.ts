import type { ExtractedExamData, ExtractedQuestion } from "./types";

export interface MediaBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MediaAssociationMode = "automatic" | "review";

export interface ExtractedMediaAsset {
  id: string;
  path: string;
  sha256: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  sourceDocumentUrl: string;
  page: number;
  bbox: MediaBoundingBox;
  questionNumber?: number;
  alternativeId?: string;
  confidence: number;
  association: MediaAssociationMode;
  /** Explicit assertion from the media extractor; absence never clears a media warning. */
  resolvesMissingMedia?: boolean;
}

export interface MediaManifest {
  protocolVersion: "enemlab-media/v1";
  providerId: string;
  sourceId: string;
  editionId: string;
  extractor: { name: string; version: string };
  document: { url: string; sha256: string };
  assets: ExtractedMediaAsset[];
  warnings?: string[];
}

export interface MediaAssociationResult {
  extraction: ExtractedExamData;
  attachedAssets: string[];
  reviewAssets: string[];
  rejectedAssets: Array<{ id: string; reason: string }>;
  resolvedQuestionNumbers: number[];
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validateAsset(asset: ExtractedMediaAsset): string | null {
  if (!asset.id.trim()) return "asset id is required";
  if (!asset.path.trim()) return "asset path is required";
  if (!/^[0-9a-f]{64}$/i.test(asset.sha256)) return "asset sha256 must be a SHA-256 digest";
  if (!/^https:\/\//.test(asset.sourceDocumentUrl)) return "asset sourceDocumentUrl must use HTTPS";
  if (!Number.isInteger(asset.page) || asset.page < 1) return "asset page must be a positive integer";
  if (!Number.isFinite(asset.confidence) || asset.confidence < 0 || asset.confidence > 1) {
    return "asset confidence must be within 0..1";
  }
  if (
    !isFiniteNonNegative(asset.bbox.x) ||
    !isFiniteNonNegative(asset.bbox.y) ||
    !Number.isFinite(asset.bbox.width) ||
    asset.bbox.width <= 0 ||
    !Number.isFinite(asset.bbox.height) ||
    asset.bbox.height <= 0
  ) {
    return "asset bbox is invalid";
  }
  if (
    asset.questionNumber !== undefined &&
    (!Number.isInteger(asset.questionNumber) || asset.questionNumber < 1)
  ) {
    return "asset questionNumber must be a positive integer";
  }
  if (asset.alternativeId !== undefined && !/^[A-Z0-9]+$/.test(asset.alternativeId)) {
    return "asset alternativeId must be canonical uppercase alphanumeric";
  }
  if (asset.alternativeId !== undefined && asset.questionNumber === undefined) {
    return "alternative media requires questionNumber";
  }
  return null;
}

function cloneQuestion(question: ExtractedQuestion): ExtractedQuestion {
  return {
    ...question,
    alternatives: question.alternatives?.map((alternative) => ({ ...alternative })),
    files: question.files ? [...question.files] : undefined,
  };
}

function cloneExtraction(extraction: ExtractedExamData): ExtractedExamData {
  return {
    ...extraction,
    questions: extraction.questions.map(cloneQuestion),
    answerKey: { ...extraction.answerKey },
    annulled: extraction.annulled ? [...extraction.annulled] : undefined,
    subjects: extraction.subjects ? { ...extraction.subjects } : undefined,
    questionsMissingMedia: extraction.questionsMissingMedia
      ? [...extraction.questionsMissingMedia]
      : undefined,
    semanticFidelityIssues: extraction.semanticFidelityIssues?.map((issue) => ({ ...issue })),
    warnings: extraction.warnings ? [...extraction.warnings] : undefined,
  };
}

/**
 * Attaches media candidates without silently claiming that a visual dependency
 * is solved. Only high-confidence `automatic` assets are attached. A preexisting
 * `questionsMissingMedia` flag is cleared only when the media extractor makes
 * the explicit `resolvesMissingMedia=true` assertion for that same question.
 */
export function associateMediaWithExtraction(
  extraction: ExtractedExamData,
  manifest: MediaManifest,
  minimumAutomaticConfidence = 0.98,
): MediaAssociationResult {
  if (manifest.protocolVersion !== "enemlab-media/v1") {
    throw new Error(`unsupported media protocol ${manifest.protocolVersion}`);
  }
  if (!manifest.providerId.trim() || !manifest.sourceId.trim() || !manifest.editionId.trim()) {
    throw new Error("media manifest identity is incomplete");
  }
  if (!manifest.extractor.name.trim() || !manifest.extractor.version.trim()) {
    throw new Error("media manifest extractor identity is incomplete");
  }
  if (!/^https:\/\//.test(manifest.document.url) || !/^[0-9a-f]{64}$/i.test(manifest.document.sha256)) {
    throw new Error("media manifest document binding is invalid");
  }
  if (!Number.isFinite(minimumAutomaticConfidence) || minimumAutomaticConfidence < 0 || minimumAutomaticConfidence > 1) {
    throw new Error("minimumAutomaticConfidence must be within 0..1");
  }

  const next = cloneExtraction(extraction);
  const byNumber = new Map(next.questions.map((question) => [question.number, question]));
  const attachedAssets: string[] = [];
  const reviewAssets: string[] = [];
  const rejectedAssets: Array<{ id: string; reason: string }> = [];
  const explicitlyResolved = new Set<number>();
  const seenIds = new Set<string>();

  for (const asset of manifest.assets) {
    const problem = validateAsset(asset);
    if (problem) {
      rejectedAssets.push({ id: asset.id, reason: problem });
      continue;
    }
    if (seenIds.has(asset.id)) {
      rejectedAssets.push({ id: asset.id, reason: "duplicate asset id" });
      continue;
    }
    seenIds.add(asset.id);

    if (
      asset.association !== "automatic" ||
      asset.confidence < minimumAutomaticConfidence ||
      asset.questionNumber === undefined
    ) {
      reviewAssets.push(asset.id);
      continue;
    }

    const question = byNumber.get(asset.questionNumber);
    if (!question) {
      rejectedAssets.push({ id: asset.id, reason: "asset points to an unknown question" });
      continue;
    }
    if (question.page !== undefined && question.page !== asset.page) {
      reviewAssets.push(asset.id);
      continue;
    }
    if (
      question.sourceDocumentUrl &&
      question.sourceDocumentUrl !== asset.sourceDocumentUrl
    ) {
      rejectedAssets.push({ id: asset.id, reason: "asset source document does not match question provenance" });
      continue;
    }

    if (asset.alternativeId) {
      const alternative = question.alternatives?.find(
        (candidate) => candidate.id === asset.alternativeId,
      );
      if (!alternative) {
        rejectedAssets.push({ id: asset.id, reason: "asset points to an unknown alternative" });
        continue;
      }
      if (alternative.file && alternative.file !== asset.path) {
        rejectedAssets.push({ id: asset.id, reason: "alternative already has different media" });
        continue;
      }
      alternative.file = asset.path;
    } else {
      const files = new Set(question.files ?? []);
      files.add(asset.path);
      question.files = [...files];
    }

    attachedAssets.push(asset.id);
    if (asset.resolvesMissingMedia) explicitlyResolved.add(question.number);
  }

  const missing = new Set(next.questionsMissingMedia ?? []);
  for (const questionNumber of explicitlyResolved) {
    const hasAttached = manifest.assets.some(
      (asset) =>
        attachedAssets.includes(asset.id) &&
        asset.questionNumber === questionNumber &&
        asset.resolvesMissingMedia === true,
    );
    if (hasAttached) missing.delete(questionNumber);
  }
  next.questionsMissingMedia = [...missing].sort((a, b) => a - b);
  next.warnings = [
    ...(next.warnings ?? []),
    ...(manifest.warnings ?? []),
    ...reviewAssets.map((id) => `mídia ${id}: associação requer revisão`),
    ...rejectedAssets.map(({ id, reason }) => `mídia ${id}: rejeitada (${reason})`),
  ];

  return {
    extraction: next,
    attachedAssets,
    reviewAssets,
    rejectedAssets,
    resolvedQuestionNumbers: [...explicitlyResolved]
      .filter((number) => !missing.has(number))
      .sort((a, b) => a - b),
  };
}
