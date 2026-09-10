export { IngestionEngine, buildIngestionJobKey } from "./engine";
export { fingerprintFetchedDocument } from "./fingerprint";
export { mapWithConcurrency } from "./concurrency";
export {
  buildExtractionCheckpointKey,
  cloneExtractedExamData,
  InMemoryExtractionCheckpointStore,
  withExtractionCheckpointCache,
} from "./checkpoint";
export type {
  CheckpointedIngestionAdapter,
  ExtractionCheckpointRecord,
  ExtractionCheckpointStats,
  ExtractionCheckpointStore,
} from "./checkpoint";
export { associateMediaWithExtraction } from "./media";
export type {
  ExtractedMediaAsset,
  MediaAssociationMode,
  MediaAssociationResult,
  MediaBoundingBox,
  MediaManifest,
} from "./media";
export {
  assessSemanticFidelity,
  buildSelectiveFallbackRequest,
  issueBlocksQuestion,
  mergeSelectiveFallback,
  questionHasCompleteStructure,
} from "./semanticFidelity";
export { createFuvestManifestAdapter } from "./adapters/fuvestManifestAdapter";
export { createFuvestExternalAdapter } from "./adapters/fuvestExternalAdapter";
export type {
  FuvestExternalPayloadLoader,
  FuvestExternalRecoveryPayloadLoader,
} from "./adapters/fuvestExternalAdapter";
export {
  consumeExternalExtraction,
  createExternalExtractionEnvelope,
  createExternalExtractionFailureEnvelope,
  ExternalExtractionNeedsFallbackError,
  EXTRACTION_FAILURE_PROTOCOL_VERSION,
  EXTRACTION_PROTOCOL_VERSION,
} from "./protocol";
export type {
  ExpectedExtractionIdentity,
  ExternalExtractionEnvelope,
  ExternalExtractionFailureEnvelope,
} from "./protocol";
export type {
  ExtractedAlternative,
  ExtractedExamData,
  ExtractedQuestion,
  FetchedIngestionDocument,
  IngestionAdapter,
  IngestionEngineIssue,
  IngestionEngineIssueCode,
  IngestionEngineOptions,
  IngestionExtractionContext,
  IngestionFallbackSummary,
  IngestionJobResult,
  IngestionJobStatus,
  IngestionPlan,
  IngestionReviewItem,
  IngestionRunResult,
  IngestionRunSummary,
  IngestionSourceFailure,
  IngestionStage,
  SelectiveFallbackReason,
  SelectiveFallbackRequest,
  SelectiveFallbackResult,
  SelectiveFallbackTarget,
  SemanticFidelityIssue,
  SemanticFidelityIssueCode,
  SemanticFidelityIssueSeverity,
  SkippedEdition,
  StagedImportedExam,
} from "./types";
