import { describe, expect, it } from "vitest";
import { normalizeFabAnswerKey, parseFabAnswerSequence } from "./index";

function raw(over: Record<string, unknown> = {}) {
  return {
    edition: "fixture",
    year: 2026,
    total: 4,
    canonicalVariant: "a",
    variantRelation: "reordered" as const,
    revision: "final" as const,
    sequence: "A B X D",
    annulled: [3],
    variants: [
      { id: "a", label: "Versão A", examUrl: null },
      { id: "b", label: "Versão B", examUrl: null },
    ],
    answerKeyUrl: "https://www.fab.mil.br/gabarito.pdf",
    examUrl: null,
    archivePage: "https://www.fab.mil.br/ingresso/provas.html",
    subjects: { portuguese: [1, 2] as [number, number], mathematics: [3, 4] as [number, number] },
    parserVersion: "fab-answer-key@1.0.0",
    ...over,
  };
}

describe("parser de gabarito FAB", () => {
  it("expande a sequência e preserva anuladas sem resposta", () => {
    expect(parseFabAnswerSequence("A B X D", 4, [3])).toEqual({
      "1": "A",
      "2": "B",
      "4": "D",
    });
  });

  it("falha fechado em cobertura, letra e anulação inconsistentes", () => {
    expect(() => parseFabAnswerSequence("A B C", 4, [3])).toThrow(/cobre 3/);
    expect(() => parseFabAnswerSequence("A B X Q", 4, [3])).toThrow(/letra inválida/);
    expect(() => parseFabAnswerSequence("A B C D", 4, [3])).toThrow(/anulada 3/);
  });

  it("recusa edição preliminar e matéria com buraco", () => {
    expect(() => normalizeFabAnswerKey(raw({ revision: "preliminary" }))).toThrow(/não é final/);
    expect(() =>
      normalizeFabAnswerKey(raw({ subjects: { portuguese: [1, 2], mathematics: [4, 4] } })),
    ).toThrow(/não cobrem/);
  });

  it("aceita a edição somente quando a versão canônica existe", () => {
    const key = normalizeFabAnswerKey(raw());
    expect(key.answers).toEqual({ "1": "A", "2": "B", "4": "D" });
    expect(key.subjects.portuguese).toEqual([1, 2]);
  });
});
