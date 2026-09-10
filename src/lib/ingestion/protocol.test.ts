import { describe, expect, it } from "vitest";
import type { IngestionExtractionContext } from "./types";
import {
  consumeExternalExtraction,
  createExternalExtractionEnvelope,
  createExternalExtractionFailureEnvelope,
  ExternalExtractionNeedsFallbackError,
  EXTRACTION_FAILURE_PROTOCOL_VERSION,
  EXTRACTION_PROTOCOL_VERSION,
} from "./protocol";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function context(): IngestionExtractionContext {
  return {
    plan: {
      editionId: "2026",
      year: 2026,
      phase: "first",
      variant: "v1",
      expectedCount: 2,
      allowedLetters: ["A", "B"],
      documents: [
        { role: "objective-exam", url: "https://example.edu/exam.pdf", phase: "first" },
        { role: "answer-key", url: "https://example.edu/key.pdf", phase: "first" },
      ],
    },
    documents: [
      {
        definition: {
          role: "objective-exam",
          url: "https://example.edu/exam.pdf",
          phase: "first",
        },
        fetched: {
          url: "https://example.edu/exam.pdf",
          bytes: new Uint8Array([1]),
          headers: {},
        },
        fingerprint: {
          url: "https://example.edu/exam.pdf",
          contentLength: 1,
          sha256: HASH_A,
          parserVersion: "test@1",
          importedAt: "2026-09-10T00:00:00Z",
        },
      },
      {
        definition: {
          role: "answer-key",
          url: "https://example.edu/key.pdf",
          phase: "first",
        },
        fetched: {
          url: "https://example.edu/key.pdf",
          bytes: new Uint8Array([2]),
          headers: {},
        },
        fingerprint: {
          url: "https://example.edu/key.pdf",
          contentLength: 1,
          sha256: HASH_B,
          parserVersion: "test@1",
          importedAt: "2026-09-10T00:00:00Z",
        },
      },
    ],
  };
}

function extraction() {
  return {
    questions: [
      { number: 1, statement: "Q1", alternatives: [{ id: "A", text: "A" }, { id: "B", text: "B" }] },
      { number: 2, statement: "Q2", alternatives: [{ id: "A", text: "A" }, { id: "B", text: "B" }] },
    ],
    answerKey: { 1: "A", 2: "B" },
  };
}

describe("external extraction protocol", () => {
  it("round-trips an extraction bound to the exact job documents", () => {
    const ctx = context();
    const envelope = createExternalExtractionEnvelope(
      ctx,
      { providerId: "test", sourceId: "official-test" },
      { name: "python-pdf", version: "1.0.0" },
      extraction(),
    );

    expect(envelope.protocolVersion).toBe(EXTRACTION_PROTOCOL_VERSION);
    expect(
      consumeExternalExtraction(envelope, ctx, {
        providerId: "test",
        sourceId: "official-test",
      }),
    ).toEqual(extraction());
  });

  it("surfaces a SHA-bound selective fallback request as a typed error", () => {
    const ctx = context();
    const envelope = createExternalExtractionFailureEnvelope(
      ctx,
      { providerId: "test", sourceId: "official-test" },
      { name: "python-pdf", version: "1.0.0" },
      "question boundaries were not recoverable",
      {
        targets: [
          {
            page: 4,
            reason: "incomplete-structure",
            message: "page has complete A-B groups but no trustworthy question marker",
          },
        ],
      },
    );

    expect(envelope.protocolVersion).toBe(EXTRACTION_FAILURE_PROTOCOL_VERSION);
    try {
      consumeExternalExtraction(envelope, ctx, {
        providerId: "test",
        sourceId: "official-test",
      });
      throw new Error("expected fallback error");
    } catch (error) {
      expect(error).toBeInstanceOf(ExternalExtractionNeedsFallbackError);
      expect((error as ExternalExtractionNeedsFallbackError).request.targets).toEqual([
        expect.objectContaining({ page: 4, reason: "incomplete-structure" }),
      ]);
    }
  });

  it("rejects a failure envelope when its document fingerprint is stale", () => {
    const ctx = context();
    const envelope = createExternalExtractionFailureEnvelope(
      ctx,
      { providerId: "test", sourceId: "official-test" },
      { name: "python-pdf", version: "1" },
      "needs OCR",
      {
        targets: [
          { page: 2, reason: "semantic-fidelity", message: "corrupt glyphs" },
        ],
      },
    );
    envelope.documents[0].sha256 = "c".repeat(64);

    expect(() =>
      consumeExternalExtraction(envelope, ctx, {
        providerId: "test",
        sourceId: "official-test",
      }),
    ).toThrow("stale document fingerprint");
  });

  it("rejects output for a different exam identity", () => {
    const ctx = context();
    const envelope = createExternalExtractionEnvelope(
      ctx,
      { providerId: "test", sourceId: "official-test" },
      { name: "model", version: "1" },
      extraction(),
    );
    envelope.identity.editionId = "2025";

    expect(() =>
      consumeExternalExtraction(envelope, ctx, {
        providerId: "test",
        sourceId: "official-test",
      }),
    ).toThrow("exam plan identity mismatch");
  });

  it("rejects stale extractor output when document bytes changed", () => {
    const ctx = context();
    const envelope = createExternalExtractionEnvelope(
      ctx,
      { providerId: "test", sourceId: "official-test" },
      { name: "model", version: "1" },
      extraction(),
    );
    envelope.documents[0].sha256 = "c".repeat(64);

    expect(() =>
      consumeExternalExtraction(envelope, ctx, {
        providerId: "test",
        sourceId: "official-test",
      }),
    ).toThrow("stale document fingerprint");
  });

  it("rejects a payload using another protocol version", () => {
    const ctx = context();
    const envelope = createExternalExtractionEnvelope(
      ctx,
      { providerId: "test", sourceId: "official-test" },
      { name: "model", version: "1" },
      extraction(),
    ) as unknown as Record<string, unknown>;
    envelope.protocolVersion = "enemlab-extraction/v999";

    expect(() =>
      consumeExternalExtraction(envelope, ctx, {
        providerId: "test",
        sourceId: "official-test",
      }),
    ).toThrow("unsupported protocolVersion");
  });
});
