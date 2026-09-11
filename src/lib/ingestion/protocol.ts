import type {
  ExtractedExamData,
  IngestionExtractionContext,
  SelectiveFallbackRequest,
  SelectiveFallbackTarget,
} from "./types";

export const EXTRACTION_PROTOCOL_VERSION = "enemlab-extraction/v1" as const;
export const EXTRACTION_FAILURE_PROTOCOL_VERSION = "enemlab-extraction-failure/v1" as const;

interface ExternalExtractionIdentity {
  providerId: string;
  sourceId: string;
  editionId: string;
  year: number;
  phase: string;
  variant?: string;
}

interface ExternalExtractorIdentity {
  name: string;
  version: string;
}

interface ExternalExtractionDocument {
  url: string;
  sha256: string;
}

export interface ExternalExtractionEnvelope {
  protocolVersion: typeof EXTRACTION_PROTOCOL_VERSION;
  identity: ExternalExtractionIdentity;
  extractor: ExternalExtractorIdentity;
  documents: ExternalExtractionDocument[];
  extraction: ExtractedExamData;
}

export interface ExternalExtractionFailureEnvelope {
  protocolVersion: typeof EXTRACTION_FAILURE_PROTOCOL_VERSION;
  identity: ExternalExtractionIdentity;
  extractor: ExternalExtractorIdentity;
  documents: ExternalExtractionDocument[];
  error: { message: string };
  fallbackRequest: SelectiveFallbackRequest;
}

export interface ExpectedExtractionIdentity {
  providerId: string;
  sourceId: string;
}

export class ExternalExtractionNeedsFallbackError extends Error {
  readonly request: SelectiveFallbackRequest;

  constructor(message: string, request: SelectiveFallbackRequest) {
    super(message);
    this.name = "ExternalExtractionNeedsFallbackError";
    this.request = {
      targets: request.targets.map((target) => ({ ...target })),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`external extraction: ${field} must be a non-empty string`);
  }
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`external extraction: ${field} must be an integer`);
  }
  return value as number;
}

function parseIdentity(value: unknown): ExternalExtractionIdentity {
  if (!isRecord(value)) throw new Error("external extraction: identity is required");
  return {
    providerId: requireString(value.providerId, "identity.providerId"),
    sourceId: requireString(value.sourceId, "identity.sourceId"),
    editionId: requireString(value.editionId, "identity.editionId"),
    year: requireInteger(value.year, "identity.year"),
    phase: requireString(value.phase, "identity.phase"),
    variant:
      value.variant === undefined
        ? undefined
        : requireString(value.variant, "identity.variant"),
  };
}

function parseExtractor(value: unknown): ExternalExtractorIdentity {
  if (!isRecord(value)) throw new Error("external extraction: extractor is required");
  return {
    name: requireString(value.name, "extractor.name"),
    version: requireString(value.version, "extractor.version"),
  };
}

function parseDocuments(value: unknown): ExternalExtractionDocument[] {
  if (!Array.isArray(value)) throw new Error("external extraction: documents must be an array");
  return value.map((document, index) => {
    if (!isRecord(document)) {
      throw new Error(`external extraction: documents[${index}] must be an object`);
    }
    const url = requireString(document.url, `documents[${index}].url`);
    const sha256 = requireString(document.sha256, `documents[${index}].sha256`).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error(`external extraction: documents[${index}].sha256 must be SHA-256`);
    }
    return { url, sha256 };
  });
}

function parseFallbackTarget(value: unknown, index: number): SelectiveFallbackTarget {
  if (!isRecord(value)) {
    throw new Error(`external extraction: fallbackRequest.targets[${index}] must be an object`);
  }
  const reason = value.reason;
  if (
    reason !== "incomplete-structure" &&
    reason !== "missing-media" &&
    reason !== "semantic-fidelity"
  ) {
    throw new Error(`external extraction: fallbackRequest.targets[${index}].reason is invalid`);
  }
  const questionNumber =
    value.questionNumber === undefined
      ? undefined
      : requireInteger(value.questionNumber, `fallbackRequest.targets[${index}].questionNumber`);
  const page =
    value.page === undefined
      ? undefined
      : requireInteger(value.page, `fallbackRequest.targets[${index}].page`);
  if ((questionNumber !== undefined && questionNumber < 1) || (page !== undefined && page < 1)) {
    throw new Error(`external extraction: fallbackRequest.targets[${index}] locator must be positive`);
  }
  if (questionNumber === undefined && page === undefined) {
    throw new Error(`external extraction: fallbackRequest.targets[${index}] needs questionNumber or page`);
  }
  return {
    questionNumber,
    page,
    reason,
    message: requireString(value.message, `fallbackRequest.targets[${index}].message`),
  };
}

function parseFallbackRequest(value: unknown): SelectiveFallbackRequest {
  if (!isRecord(value) || !Array.isArray(value.targets) || value.targets.length === 0) {
    throw new Error("external extraction: fallbackRequest.targets must be a non-empty array");
  }
  return {
    targets: value.targets.map(parseFallbackTarget),
  };
}

function parseEnvelope(value: unknown): ExternalExtractionEnvelope {
  if (!isRecord(value)) throw new Error("external extraction: payload must be an object");
  if (value.protocolVersion !== EXTRACTION_PROTOCOL_VERSION) {
    throw new Error(`external extraction: unsupported protocolVersion ${String(value.protocolVersion)}`);
  }
  if (!isRecord(value.extraction)) throw new Error("external extraction: extraction is required");

  const extraction = value.extraction as unknown as ExtractedExamData;
  if (!Array.isArray(extraction.questions)) {
    throw new Error("external extraction: extraction.questions must be an array");
  }
  if (!isRecord(extraction.answerKey)) {
    throw new Error("external extraction: extraction.answerKey must be an object");
  }
  if (
    extraction.semanticFidelityIssues !== undefined &&
    !Array.isArray(extraction.semanticFidelityIssues)
  ) {
    throw new Error("external extraction: extraction.semanticFidelityIssues must be an array");
  }

  return {
    protocolVersion: EXTRACTION_PROTOCOL_VERSION,
    identity: parseIdentity(value.identity),
    extractor: parseExtractor(value.extractor),
    documents: parseDocuments(value.documents),
    extraction,
  };
}

function parseFailureEnvelope(value: unknown): ExternalExtractionFailureEnvelope {
  if (!isRecord(value)) throw new Error("external extraction: payload must be an object");
  if (value.protocolVersion !== EXTRACTION_FAILURE_PROTOCOL_VERSION) {
    throw new Error(`external extraction: unsupported protocolVersion ${String(value.protocolVersion)}`);
  }
  if (!isRecord(value.error)) throw new Error("external extraction: error is required");

  return {
    protocolVersion: EXTRACTION_FAILURE_PROTOCOL_VERSION,
    identity: parseIdentity(value.identity),
    extractor: parseExtractor(value.extractor),
    documents: parseDocuments(value.documents),
    error: { message: requireString(value.error.message, "error.message") },
    fallbackRequest: parseFallbackRequest(value.fallbackRequest),
  };
}

function sameOptionalString(left: string | undefined, right: string | undefined): boolean {
  return (left ?? "") === (right ?? "");
}

function verifyEnvelopeBinding(
  envelope: Pick<ExternalExtractionEnvelope, "identity" | "documents">,
  context: IngestionExtractionContext,
  expected: ExpectedExtractionIdentity,
): void {
  const { plan } = context;

  if (envelope.identity.providerId !== expected.providerId) {
    throw new Error("external extraction: provider identity mismatch");
  }
  if (envelope.identity.sourceId !== expected.sourceId) {
    throw new Error("external extraction: source identity mismatch");
  }
  if (
    envelope.identity.editionId !== plan.editionId ||
    envelope.identity.year !== plan.year ||
    envelope.identity.phase !== plan.phase ||
    !sameOptionalString(envelope.identity.variant, plan.variant)
  ) {
    throw new Error("external extraction: exam plan identity mismatch");
  }

  if (envelope.documents.length !== context.documents.length) {
    throw new Error("external extraction: document set size mismatch");
  }

  const expectedDocuments = new Map(
    context.documents.map(({ fingerprint }) => [fingerprint.url, fingerprint.sha256.toLowerCase()]),
  );
  if (expectedDocuments.size !== context.documents.length) {
    throw new Error("external extraction: engine context contains duplicate document URLs");
  }

  const seen = new Set<string>();
  for (const document of envelope.documents) {
    if (seen.has(document.url)) {
      throw new Error(`external extraction: duplicate document ${document.url}`);
    }
    seen.add(document.url);
    const expectedSha = expectedDocuments.get(document.url);
    if (!expectedSha) {
      throw new Error(`external extraction: unexpected document ${document.url}`);
    }
    if (expectedSha !== document.sha256) {
      throw new Error(`external extraction: stale document fingerprint for ${document.url}`);
    }
  }
}

/**
 * Accepts output from Python, an LLM worker, OCR service or any other external
 * extractor only when it is cryptographically bound to the exact documents
 * downloaded by this engine job.
 *
 * A failure envelope is also bound to those documents. It does not authorize a
 * full retry: it carries explicit page/question targets and is surfaced as a
 * typed error so an adapter can route only those targets to OCR/AI recovery.
 */
export function consumeExternalExtraction(
  payload: unknown,
  context: IngestionExtractionContext,
  expected: ExpectedExtractionIdentity,
): ExtractedExamData {
  if (isRecord(payload) && payload.protocolVersion === EXTRACTION_FAILURE_PROTOCOL_VERSION) {
    const failure = parseFailureEnvelope(payload);
    verifyEnvelopeBinding(failure, context, expected);
    throw new ExternalExtractionNeedsFallbackError(
      failure.error.message,
      failure.fallbackRequest,
    );
  }

  const envelope = parseEnvelope(payload);
  verifyEnvelopeBinding(envelope, context, expected);

  return {
    ...envelope.extraction,
    questions: envelope.extraction.questions.map((question) => ({
      ...question,
      alternatives: question.alternatives?.map((alternative) => ({ ...alternative })),
      files: question.files ? [...question.files] : undefined,
    })),
    answerKey: { ...envelope.extraction.answerKey },
    annulled: envelope.extraction.annulled ? [...envelope.extraction.annulled] : undefined,
    subjects: envelope.extraction.subjects ? { ...envelope.extraction.subjects } : undefined,
    questionsMissingMedia: envelope.extraction.questionsMissingMedia
      ? [...envelope.extraction.questionsMissingMedia]
      : undefined,
    semanticFidelityIssues: envelope.extraction.semanticFidelityIssues
      ? envelope.extraction.semanticFidelityIssues.map((issue) => ({ ...issue }))
      : undefined,
    warnings: envelope.extraction.warnings ? [...envelope.extraction.warnings] : undefined,
  };
}

export function createExternalExtractionEnvelope(
  context: IngestionExtractionContext,
  identity: ExpectedExtractionIdentity,
  extractor: ExternalExtractionEnvelope["extractor"],
  extraction: ExtractedExamData,
): ExternalExtractionEnvelope {
  return {
    protocolVersion: EXTRACTION_PROTOCOL_VERSION,
    identity: {
      providerId: identity.providerId,
      sourceId: identity.sourceId,
      editionId: context.plan.editionId,
      year: context.plan.year,
      phase: context.plan.phase,
      variant: context.plan.variant,
    },
    extractor: { ...extractor },
    documents: context.documents.map(({ fingerprint }) => ({
      url: fingerprint.url,
      sha256: fingerprint.sha256.toLowerCase(),
    })),
    extraction,
  };
}

export function createExternalExtractionFailureEnvelope(
  context: IngestionExtractionContext,
  identity: ExpectedExtractionIdentity,
  extractor: ExternalExtractionFailureEnvelope["extractor"],
  message: string,
  fallbackRequest: SelectiveFallbackRequest,
): ExternalExtractionFailureEnvelope {
  if (!fallbackRequest.targets.length) {
    throw new Error("external extraction failure envelope requires fallback targets");
  }
  return {
    protocolVersion: EXTRACTION_FAILURE_PROTOCOL_VERSION,
    identity: {
      providerId: identity.providerId,
      sourceId: identity.sourceId,
      editionId: context.plan.editionId,
      year: context.plan.year,
      phase: context.plan.phase,
      variant: context.plan.variant,
    },
    extractor: { ...extractor },
    documents: context.documents.map(({ fingerprint }) => ({
      url: fingerprint.url,
      sha256: fingerprint.sha256.toLowerCase(),
    })),
    error: { message },
    fallbackRequest: {
      targets: fallbackRequest.targets.map((target) => ({ ...target })),
    },
  };
}
