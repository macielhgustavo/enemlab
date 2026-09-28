import { describe, expect, it } from "vitest";
import type { Question } from "../domain/types";
import {
  NativeContentUnavailableError,
  assertNativeQuestionCoverage,
  isQuestionNativeRenderable,
  nativeQuestionCoverage,
} from "./readiness";

function question(overrides: Partial<Question> = {}): Question {
  return {
    providerId: "fuvest",
    year: 2026,
    phase: "first",
    index: 1,
    number: 1,
    discipline: "conhecimentos-gerais",
    alternatives: ["A", "B", "C", "D", "E"].map((letter) => ({
      letter,
      text: "",
      isCorrect: letter === "A",
    })),
    correctAlternative: "A",
    files: [],
    ...overrides,
  };
}

describe("native-only study contract", () => {
  it("recusa referência externa mesmo quando existe documento oficial", () => {
    const q = question({
      statementAvailable: false,
      official: {
        official: true,
        institution: "FUVEST",
        documentUrl: "https://example.com/prova.pdf",
      },
    });
    expect(isQuestionNativeRenderable(q)).toBe(false);
  });

  it("aceita NativePack visual integral", () => {
    expect(
      isQuestionNativeRenderable(
        question({
          statementAvailable: true,
          files: ["https://signed.example.com/q1.webp"],
        }),
      ),
    ).toBe(true);
  });

  it("aceita provider com enunciado semântico integral", () => {
    expect(
      isQuestionNativeRenderable(
        question({
          context: "Enunciado completo no renderer.",
          alternatives: [{ letter: "A", text: "Alternativa", isCorrect: true }],
        }),
      ),
    ).toBe(true);
  });

  it("torna a edição atômica: uma questão incompleta bloqueia o lote", () => {
    const ready = question({ context: "Questão pronta." });
    const missing = question({ index: 2, number: 2, statementAvailable: false });
    const coverage = nativeQuestionCoverage([ready, missing]);
    expect(coverage).toEqual({ total: 2, ready: 1, missing: [2], complete: false });
    expect(() =>
      assertNativeQuestionCoverage([ready, missing], {
        providerId: "fuvest",
        year: 2026,
      }),
    ).toThrow(NativeContentUnavailableError);
  });
});
