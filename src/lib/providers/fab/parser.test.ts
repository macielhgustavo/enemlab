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
    variantAnswers: {
      a: { "1": "A", "2": "B", "3": "X", "4": "D" },
      b: { "1": "C", "2": "D", "3": "B", "4": "A" },
    },
    answerKeyUrl: "https://www.fab.mil.br/gabarito.pdf",
    examUrl: null,
    archivePage: "https://www.fab.mil.br/ingresso/provas.html",
    subjects: { portuguese: [1, 2] as [number, number], mathematics: [3, 4] as [number, number] },
    subjectsDerivedFrom: "answer-key-header" as const,
    subjectBoundariesVerified: false,
    retrieval: {
      route: "web-archive" as const,
      retrievedFrom: "https://web.archive.org/web/2024id_/https://www.fab.mil.br/gabarito.pdf",
      sha256: "0".repeat(64),
      bytes: 1234,
      importedAt: "2026-09-07",
    },
    parserVersion: "fab-answer-key@2.0.0",
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

  it("recusa sequência que não bate com a versão canônica", () => {
    // A barreira que faltava. Na AFA 2023 a sequência trazia, da questão 31
    // em diante, as letras da versão C — leitura que derivou de coluna no
    // meio da tabela. Comparar a sequência com as questões geradas não pega
    // isso: os dois lados vêm do mesmo campo. Comparar com a coluna lida,
    // pega.
    expect(() =>
      normalizeFabAnswerKey(raw({ sequence: "A B X A" })),
    ).toThrow(/questão 4: sequência diz A, versão canônica diz D/);
  });

  it("recusa duas versões com gabarito idêntico", () => {
    // Numa prova reordenada as versões precisam divergir. Igualdade indica
    // parser que leu o mesmo bloco duas vezes.
    expect(() =>
      normalizeFabAnswerKey(
        raw({
          variantAnswers: {
            a: { "1": "A", "2": "B", "3": "X", "4": "D" },
            b: { "1": "A", "2": "B", "3": "X", "4": "D" },
          },
        }),
      ),
    ).toThrow(/têm gabarito idêntico/);
  });

  it("recusa versão declarada sem gabarito lido", () => {
    expect(() =>
      normalizeFabAnswerKey(
        raw({ variantAnswers: { a: { "1": "A", "2": "B", "3": "X", "4": "D" } } }),
      ),
    ).toThrow(/versão b declarada sem gabarito lido/);
  });

  it("recusa edição sem o bloco de versões, em vez de estourar", () => {
    // Formato anterior ao importador que lê o documento.
    expect(() => normalizeFabAnswerKey(raw({ variantAnswers: undefined }))).toThrow(
      /sem gabarito por versão/,
    );
  });
});
