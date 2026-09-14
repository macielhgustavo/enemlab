import { describe, expect, it } from "vitest";
import type { Question } from "../domain/types";
import {
  applyLocalNativeDraft,
  parseLocalNativeBundle,
  type LocalNativeQuestionDraft,
} from "./localDraft";

const baseQuestion: Question = {
  providerId: "unesp",
  year: 2026,
  phase: "first",
  index: 1,
  number: 1,
  discipline: "conhecimentos-gerais",
  context: undefined,
  statementAvailable: false,
  alternatives: [
    { letter: "A", text: "", isCorrect: false },
    { letter: "B", text: "", isCorrect: true },
    { letter: "C", text: "", isCorrect: false },
    { letter: "D", text: "", isCorrect: false },
    { letter: "E", text: "", isCorrect: false },
  ],
  correctAlternative: "B",
};

const draft: LocalNativeQuestionDraft = {
  providerId: "unesp",
  year: 2026,
  phase: "first",
  number: 1,
  context: "Enunciado fornecido no cache privado do usuário.",
  alternatives: ["A", "B", "C", "D", "E"].map((letter) => ({
    letter,
    text: `Alternativa ${letter}`,
  })),
  sourceDocumentSha256: "a".repeat(64),
};

describe("private native draft", () => {
  it("preenche texto sem alterar o gabarito validado pelo provider", () => {
    const overlaid = applyLocalNativeDraft(baseQuestion, draft);
    expect(overlaid.statementAvailable).toBe(true);
    expect(overlaid.context).toBe(draft.context);
    expect(overlaid.correctAlternative).toBe("B");
    expect(overlaid.alternatives?.find((alternative) => alternative.isCorrect)?.letter).toBe("B");
  });

  it("falha fechado quando o conjunto de alternativas diverge", () => {
    const incompatible = {
      ...draft,
      alternatives: draft.alternatives.slice(0, 4),
    };
    expect(applyLocalNativeDraft(baseQuestion, incompatible)).toBe(baseQuestion);
  });

  it("aceita o contrato v2 private sem permitir resposta correta no bundle", () => {
    const parsed = parseLocalNativeBundle(
      JSON.stringify({
        version: 2,
        usage: "private",
        createdAt: "2026-09-13T12:00:00-03:00",
        questions: [{ ...draft, correctAlternative: "A" }],
      }),
    );
    expect(parsed.version).toBe(2);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0]).not.toHaveProperty("correctAlternative");
  });

  it("continua aceitando bundles v1 já existentes", () => {
    const parsed = parseLocalNativeBundle(
      JSON.stringify({
        version: 1,
        distribution: "local-only",
        createdAt: "2026-09-13T12:00:00-03:00",
        questions: [draft],
      }),
    );
    expect(parsed.version).toBe(1);
    expect(parsed.questions).toHaveLength(1);
  });

  it("rejeita v2 fora do escopo privado", () => {
    expect(() =>
      parseLocalNativeBundle(
        JSON.stringify({
          version: 2,
          usage: "public",
          createdAt: "2026-09-13T12:00:00-03:00",
          questions: [draft],
        }),
      ),
    ).toThrow(/usage=private/);
  });
});
