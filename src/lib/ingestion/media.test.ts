import { describe, expect, it } from "vitest";
import {
  associateMediaWithExtraction,
  type ExpectedMediaBinding,
  type MediaManifest,
} from "./media";
import type { ExtractedExamData } from "./types";

function extraction(): ExtractedExamData {
  return {
    questions: [
      {
        number: 1,
        page: 3,
        sourceDocumentUrl: "https://example.test/prova.pdf",
        statement: "Observe a figura.",
        alternatives: [
          { id: "A", text: "A" },
          { id: "B", text: "B" },
        ],
      },
      {
        number: 2,
        page: 4,
        sourceDocumentUrl: "https://example.test/prova.pdf",
        statement: "Questão sem mídia",
        alternatives: [
          { id: "A", text: "A" },
          { id: "B", text: "B" },
        ],
      },
    ],
    answerKey: { 1: "A", 2: "B" },
    questionsMissingMedia: [1],
  };
}

function manifest(overrides: Partial<MediaManifest> = {}): MediaManifest {
  return {
    protocolVersion: "enemlab-media/v1",
    providerId: "teste",
    sourceId: "teste-oficial",
    editionId: "2025",
    extractor: { name: "media", version: "1" },
    document: {
      url: "https://example.test/prova.pdf",
      sha256: "a".repeat(64),
    },
    assets: [
      {
        id: "q1-figure-1",
        path: "/media/q1-figure-1.png",
        sha256: "b".repeat(64),
        mimeType: "image/png",
        sourceDocumentUrl: "https://example.test/prova.pdf",
        page: 3,
        bbox: { x: 10, y: 20, width: 100, height: 80 },
        questionNumber: 1,
        confidence: 0.995,
        association: "automatic",
      },
    ],
    ...overrides,
  };
}

function binding(overrides: Partial<ExpectedMediaBinding> = {}): ExpectedMediaBinding {
  return {
    providerId: "teste",
    sourceId: "teste-oficial",
    editionId: "2025",
    documentUrl: "https://example.test/prova.pdf",
    documentSha256: "a".repeat(64),
    ...overrides,
  };
}

describe("media association", () => {
  it("attaches high-confidence media but preserves missing-media until explicitly resolved", () => {
    const result = associateMediaWithExtraction(extraction(), manifest(), binding());

    expect(result.attachedAssets).toEqual(["q1-figure-1"]);
    expect(result.extraction.questions[0].files).toEqual(["/media/q1-figure-1.png"]);
    expect(result.extraction.questionsMissingMedia).toEqual([1]);
    expect(result.resolvedQuestionNumbers).toEqual([]);
  });

  it("clears missing-media only with an explicit resolution assertion", () => {
    const value = manifest();
    value.assets[0].resolvesMissingMedia = true;
    const result = associateMediaWithExtraction(extraction(), value, binding());

    expect(result.extraction.questionsMissingMedia).toEqual([]);
    expect(result.resolvedQuestionNumbers).toEqual([1]);
  });

  it("sends low-confidence or review-mode assets to review without attaching them", () => {
    const value = manifest();
    value.assets[0].confidence = 0.7;
    const result = associateMediaWithExtraction(extraction(), value, binding());

    expect(result.attachedAssets).toEqual([]);
    expect(result.reviewAssets).toEqual(["q1-figure-1"]);
    expect(result.extraction.questions[0].files).toBeUndefined();
    expect(result.extraction.questionsMissingMedia).toEqual([1]);
  });

  it("rejects asset provenance mismatch instead of silently attaching media", () => {
    const value = manifest();
    value.assets[0].sourceDocumentUrl = "https://example.test/outra.pdf";
    const result = associateMediaWithExtraction(extraction(), value, binding());

    expect(result.attachedAssets).toEqual([]);
    expect(result.rejectedAssets[0].reason).toMatch(/media manifest/i);
  });

  it("rejects a manifest from another edition or document SHA before association", () => {
    expect(() =>
      associateMediaWithExtraction(extraction(), manifest(), binding({ editionId: "2024" })),
    ).toThrow(/identity/i);
    expect(() =>
      associateMediaWithExtraction(
        extraction(),
        manifest(),
        binding({ documentSha256: "c".repeat(64) }),
      ),
    ).toThrow(/SHA binding/i);
  });

  it("attaches pure-visual alternatives without overwriting conflicting media", () => {
    const value = manifest();
    value.assets[0].alternativeId = "A";
    value.assets[0].resolvesMissingMedia = true;
    const result = associateMediaWithExtraction(extraction(), value, binding());

    expect(result.extraction.questions[0].alternatives?.[0].file).toBe(
      "/media/q1-figure-1.png",
    );
    expect(result.extraction.questionsMissingMedia).toEqual([]);
  });
});
