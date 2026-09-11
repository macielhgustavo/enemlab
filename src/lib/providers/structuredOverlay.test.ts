import { describe, expect, it } from "vitest";
import type { NormalizedQuestion } from "./types";
import {
  withStructuredQuestionContent,
  type UniversalStructuredQuestion,
} from "./structuredRegistry";

function baseQuestion(): NormalizedQuestion {
  return {
    providerId: "test-provider",
    examId: "test-provider-2025-first",
    year: 2025,
    index: 1,
    number: 1,
    phase: "first",
    language: null,
    subject: { id: "math", label: "Matemática", area: "math" },
    content: "Matemática",
    context: null,
    alternativesIntroduction: null,
    alternatives: [
      { letter: "A", text: null, file: null, isCorrect: true },
      { letter: "B", text: null, file: null, isCorrect: false },
    ],
    correctAlternative: "A",
    files: [],
    sources: [],
    type: "multiple_choice",
    statementAvailable: false,
    official: {
      official: true,
      institution: "Test Provider",
      documentUrl: "https://example.edu/reference.pdf",
    },
    expectedAnswer: null,
  };
}

function nativeQuestion(): UniversalStructuredQuestion {
  return {
    providerId: "test-provider",
    year: 2025,
    number: 1,
    phase: "first",
    statement: "Enunciado nativo",
    context: "Contexto",
    alternativesIntroduction: "Assinale a correta:",
    alternatives: [
      { letter: "A", file: "/native/a.svg" },
      { letter: "B", text: "Alternativa B" },
    ],
    files: ["/native/diagram.svg"],
    sources: [{ label: "Fonte citada", url: "https://example.edu/source" }],
    validationLevel: "reviewed",
    provenance: {
      documentUrl: "https://example.edu/native.pdf",
      page: 7,
      documentSha256: "b".repeat(64),
      parserVersion: "native-test@1.0.0",
      extractionMethod: "manual",
      rightsStatus: "allowed",
      reviewedAt: "2026-09-09T18:00:00-03:00",
    },
  };
}

describe("structured provider overlay", () => {
  it("overlays content and media without changing correction identity", () => {
    const result = withStructuredQuestionContent(
      baseQuestion(),
      nativeQuestion(),
      "Test Provider",
    );

    expect(result.content).toBe("Matemática");
    expect(result.context).toBe("Contexto\n\nEnunciado nativo");
    expect(result.statementAvailable).toBe(true);
    expect(result.correctAlternative).toBe("A");
    expect(result.alternatives[0].isCorrect).toBe(true);
    expect(result.alternatives[0].file).toBe("/native/a.svg");
    expect(result.files).toEqual(["/native/diagram.svg"]);
    expect(result.official).toMatchObject({
      documentUrl: "https://example.edu/native.pdf",
      page: 7,
    });
  });

  it("rejects native content for a different question identity", () => {
    const native = nativeQuestion();
    native.number = 2;

    expect(() =>
      withStructuredQuestionContent(baseQuestion(), native, "Test Provider"),
    ).toThrow(/identity does not match/);
  });

  it("rejects an alternative set that does not match the provider", () => {
    const native = nativeQuestion();
    native.alternatives = [
      { letter: "A", text: "A" },
      { letter: "C", text: "C" },
    ];

    expect(() =>
      withStructuredQuestionContent(baseQuestion(), native, "Test Provider"),
    ).toThrow(/alternative set does not match/);
  });
});
