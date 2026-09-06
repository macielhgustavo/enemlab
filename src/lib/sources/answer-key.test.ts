import { describe, expect, it } from "vitest";
import {
  diffAnswerKeys,
  inspectAnswerKey,
  selectAuthoritativeKey,
  type AnswerKeyDocument,
} from "./answer-key";

/**
 * Gabarito é o dado mais crítico da plataforma.
 *
 * Enunciado errado o aluno percebe. Gabarito errado ensina a resposta errada
 * e ainda contamina histórico, SRS e mapa de domínio — o estrago se espalha
 * sem ninguém ver.
 */

function doc(over: Partial<AnswerKeyDocument> = {}): AnswerKeyDocument {
  return {
    revision: "final",
    answers: { 1: "A", 2: "B", 3: "C" },
    annulled: [],
    fingerprint: {
      url: "https://exemplo/gabarito.pdf",
      contentLength: 100,
      sha256: "abc",
      parserVersion: "teste@1.0.0",
      importedAt: "2026-01-01T00:00:00.000Z",
    },
    ...over,
  };
}

describe("qual gabarito vale", () => {
  it("o final vence o preliminar", () => {
    const r = selectAuthoritativeKey([
      doc({ revision: "preliminary", answers: { 1: "A", 2: "A", 3: "A" } }),
      doc({ revision: "final" }),
    ]);
    expect(r.key?.revision).toBe("final");
    expect(r.onlyPreliminary).toBe(false);
    expect(r.superseded).toHaveLength(1);
  });

  it("a retificação vence o final", () => {
    const r = selectAuthoritativeKey([doc({ revision: "final" }), doc({ revision: "rectified" })]);
    expect(r.key?.revision).toBe("rectified");
  });

  it("preliminar sozinho é usado, mas quem chama fica sabendo", () => {
    const r = selectAuthoritativeKey([doc({ revision: "preliminary" })]);
    expect(r.key?.revision).toBe("preliminary");
    expect(r.onlyPreliminary).toBe(true);
  });

  it("sem gabarito nenhum, não inventa", () => {
    const r = selectAuthoritativeKey([]);
    expect(r.key).toBeNull();
  });

  it("a ordem de entrada não muda a escolha", () => {
    // O importador não controla em que ordem encontra os arquivos.
    const a = selectAuthoritativeKey([doc({ revision: "rectified" }), doc({ revision: "preliminary" })]);
    const b = selectAuthoritativeKey([doc({ revision: "preliminary" }), doc({ revision: "rectified" })]);
    expect(a.key?.revision).toBe(b.key?.revision);
  });
});

describe("integridade do gabarito", () => {
  const esperado = { total: 3, allowedLetters: ["A", "B", "C", "D", "E"] };

  it("aprova gabarito completo e coerente", () => {
    expect(inspectAnswerKey(doc(), esperado)).toEqual([]);
  });

  it("recusa questão fora do intervalo da prova", () => {
    const p = inspectAnswerKey(doc({ answers: { 1: "A", 2: "B", 3: "C", 9: "D" } }), esperado);
    expect(p.map((x) => x.code)).toContain("out-of-range");
  });

  it("recusa letra que a prova não usa", () => {
    const p = inspectAnswerKey(doc({ answers: { 1: "A", 2: "B", 3: "Z" } }), esperado);
    expect(p.map((x) => x.code)).toContain("invalid-letter");
  });

  it("recusa anulada com resposta atribuída", () => {
    // Se está anulada e tem resposta, uma das duas fontes está errada e não
    // há como saber qual — então nenhuma vale.
    const p = inspectAnswerKey(doc({ annulled: [2] }), esperado);
    expect(p.map((x) => x.code)).toContain("annulled-with-answer");
  });

  it("recusa buraco na cobertura", () => {
    const p = inspectAnswerKey(doc({ answers: { 1: "A", 3: "C" } }), esperado);
    const buraco = p.find((x) => x.code === "gap");
    expect(buraco?.numbers).toEqual([2]);
  });

  it("anulada preenche a cobertura sem ter resposta", () => {
    const p = inspectAnswerKey(doc({ answers: { 1: "A", 3: "C" }, annulled: [2] }), esperado);
    expect(p).toEqual([]);
  });

  it("gabarito vazio é recusado de imediato", () => {
    const p = inspectAnswerKey(doc({ answers: {}, annulled: [] }), esperado);
    expect(p.map((x) => x.code)).toEqual(["empty"]);
  });
});

describe("o que a retificação mudou", () => {
  it("mostra resposta trocada, anulação nova e desanulação", () => {
    const antes = doc({ revision: "final", answers: { 1: "A", 2: "B", 3: "C" }, annulled: [4] });
    const depois = doc({
      revision: "rectified",
      answers: { 1: "A", 2: "D", 3: "C", 4: "E" },
      annulled: [2],
    });

    const d = diffAnswerKeys(antes, depois);
    expect(d.changed).toEqual([{ number: 2, from: "B", to: "D" }]);
    expect(d.newlyAnnulled).toEqual([2]);
    expect(d.unannulled).toEqual([4]);
  });

  it("gabaritos iguais não produzem diferença", () => {
    const d = diffAnswerKeys(doc(), doc());
    expect(d.changed).toEqual([]);
    expect(d.newlyAnnulled).toEqual([]);
    expect(d.unannulled).toEqual([]);
  });
});
