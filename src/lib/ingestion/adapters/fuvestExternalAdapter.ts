import { fuvestAnswerKey } from "../../providers/fuvest";
import {
  consumeExternalExtraction,
  ExternalExtractionNeedsFallbackError,
} from "../protocol";
import type {
  IngestionAdapter,
  IngestionExtractionContext,
  SelectiveFallbackRequest,
} from "../types";
import { createFuvestManifestAdapter } from "./fuvestManifestAdapter";

export type FuvestExternalPayloadLoader = (
  context: IngestionExtractionContext,
) => unknown | Promise<unknown>;

export type FuvestExternalRecoveryPayloadLoader = (
  context: IngestionExtractionContext,
  request: SelectiveFallbackRequest,
) => unknown | Promise<unknown>;

/**
 * FUVEST adapter for full question-text extraction experiments.
 *
 * The reviewed manifest adapter remains the source of discovery/planning and
 * answer-key truth. This wrapper only replaces `extract()` with an external
 * payload bound to the exact SHA-256 documents fetched by the engine.
 *
 * A primary extractor may return `enemlab-extraction-failure/v1` with explicit
 * page/question targets. When a recovery loader is supplied, only those targets
 * need OCR/AI work; the recovery loader must still return a complete, SHA-bound
 * `enemlab-extraction/v1` envelope before the engine accepts anything.
 *
 * Editions without a canonical exam PDF (currently FUVEST 2022 in the
 * reviewed manifest) remain valid as reference-only catalog data, but are not
 * eligible for question-text extraction.
 */
export function createFuvestExternalAdapter(
  loadPayload: FuvestExternalPayloadLoader,
  loadRecoveryPayload?: FuvestExternalRecoveryPayloadLoader,
): IngestionAdapter {
  const base = createFuvestManifestAdapter();
  const baseDiscovery = base.discovery;
  const expected = {
    providerId: base.providerId,
    sourceId: base.sourceId,
  };

  return {
    ...base,
    importerVersion: "fuvest-question-extraction-adapter@1.1.0",
    discovery: {
      ...baseDiscovery,
      isAllowed(edition) {
        const entry = fuvestAnswerKey(edition.year);
        return baseDiscovery.isAllowed(edition) && Boolean(entry?.examUrl);
      },
    },
    async extract(context) {
      const payload = await loadPayload(context);
      try {
        return consumeExternalExtraction(payload, context, expected);
      } catch (error) {
        if (!(error instanceof ExternalExtractionNeedsFallbackError) || !loadRecoveryPayload) {
          throw error;
        }
        const recoveredPayload = await loadRecoveryPayload(context, error.request);
        return consumeExternalExtraction(recoveredPayload, context, expected);
      }
    },
  };
}
