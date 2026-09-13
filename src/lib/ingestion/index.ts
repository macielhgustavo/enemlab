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
export {
  corpusDocumentsForExam,
  corpusEvidence,
  parseCorpusPackageManifestV1,
} from "./corpus";
export type {
  CorpusDocumentEvidence,
  CorpusPackageExamV1,
  CorpusPackageFileV1,
  CorpusPackageManifestV1,
  CorpusSourceAuthority,
} from "./corpus";
export {
  buildReviewContentFingerprint,
  getApplicableReviewDecision,
  handoffReviewedJobToCatalog,
  InMemoryReviewDecisionStore,
  recordReviewDecision,
} from "./review";
export type {
  ApprovedValidationLevel,
  IngestionReviewDecision,
  RecordReviewInput,
  ReviewDecisionStore,
  ReviewDisposition,
  ReviewedCatalogHandoff,
} from "./review";
export { associateMediaWithExtraction, verifyMediaManifestBinding } from "./media";
export type {
  ExpectedMediaBinding,
  ExtractedMediaAsset,
  MediaAssociationMode,
  MediaAssociationResult,
  MediaBoundingBox,
  MediaManifest,
} from "./media";
export {
  buildExceptionReductionPlan,
  clusterExceptionObservations,
  collectJobExceptionObservations,
  DEFAULT_REPAIR_STRATEGIES,
  normalizeExceptionMessage,
  routeRepairStrategies,
} from "./exceptionReducer";
export type {
  ExceptionCluster,
  ExceptionFieldScope,
  ExceptionObservation,
  ExceptionReductionMetrics,
  ExceptionReductionPlan,
  ExceptionRootCause,
  RepairRouteStep,
  RepairScope,
  RepairStrategy,
  RepairTier,
} from "./exceptionReducer";
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
