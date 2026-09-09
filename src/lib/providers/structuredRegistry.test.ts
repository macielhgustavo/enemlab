import { describe, expect, it } from "vitest";
import {
  getStructuredQuestion,
  registerStructuredQuestion,
  type UniversalStructuredQuestion,
} from "./structuredRegistry";

function reviewedQuestion(number: number): UniversalStructuredQuestion {
  return {
    providerId: "registry-test",
    year: 2025,
    number,
    phase: "first",
    statement: `Enunciado oficial ${number}`,
    alternatives: [
      { letter: "A", text: "Alternativa A" },
      { letter: "B", text: "Alternativa B" },
    ],
    validationLevel: "reviewed",
    provenance: {
      documentUrl: "https://example.edu/prova-oficial.pdf",
      documentSha256: "a".repeat(64),
      parserVersion: "registry-test@1.0.0",
      extractionMethod: "manual-transcription",
      reviewedAt: "2026-09-09T18:00:00-03:00",
    },
  };
}

describe("structured question registry", () => {
  it("does not expose content that was never registered as reviewed", () => {
    expect(getStructuredQuestion("registry-test", 2025, 999, "first")).toBeNull();
  });

  it("accepts reviewed native content with reproducible provenance", () => {
    registerStructuredQuestion(reviewedQuestion(1));

    const question = getStructuredQuestion("registry-test", 2025, 1, "first");
    expect(question?.statement).toBe("Enunciado oficial 1");
    expect(question?.validationLevel).toBe("reviewed");
    expect(question?.provenance.documentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects content without a valid document fingerprint", () => {
    const question = reviewedQuestion(2);
    question.provenance.documentSha256 = "not-a-sha256";

    expect(() => registerStructuredQuestion(question)).toThrow(/documentSha256/);
    expect(getStructuredQuestion("registry-test", 2025, 2, "first")).toBeNull();
  });

  it("returns copies so consumers cannot mutate the registry", () => {
    registerStructuredQuestion(reviewedQuestion(3));
    const first = getStructuredQuestion("registry-test", 2025, 3, "first")!;
    first.alternatives[0].text = "alterado";

    const second = getStructuredQuestion("registry-test", 2025, 3, "first")!;
    expect(second.alternatives[0].text).toBe("Alternativa A");
  });
});
