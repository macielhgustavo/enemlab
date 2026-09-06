import { describe, expect, it } from "vitest";
import { officialRows, officialRowsOf, providersInHistory, areaStats, masteryStats } from "./stats";
import { makeDB, makeRow, makeAttempt } from "./__fixtures__/db";

// Cenário: histórico com uma tentativa legada (sem providerId, portanto ENEM)
// e outra de uma prova diferente já carimbada.
function dbMisto() {
  const legado = makeAttempt({
    id: "a_legado",
    result: {
      rows: [makeRow({ key: "l1", isCorrect: true }), makeRow({ key: "l2", isCorrect: false })],
      correct: 1,
      total: 2,
      blank: 0,
    },
  });
  delete (legado as { providerId?: string }).providerId;

  const outra = makeAttempt({
    id: "a_outra",
    providerId: "outra-prova",
    result: {
      rows: [
        makeRow({ key: "o1", isCorrect: false, providerId: "outra-prova" }),
        makeRow({ key: "o2", isCorrect: false, providerId: "outra-prova" }),
      ],
      correct: 0,
      total: 2,
      blank: 0,
    },
  });

  return makeDB({ attempts: [legado, outra] });
}

describe("escopo por prova", () => {
  it("trata tentativa sem providerId como ENEM", () => {
    const rows = officialRows(dbMisto());
    const legadas = rows.filter((r) => r.key.startsWith("l"));
    expect(legadas).toHaveLength(2);
    expect(legadas.every((r) => r.providerId === "enem")).toBe(true);
  });

  it("herda a prova da tentativa quando a linha não tem", () => {
    const db = makeDB({
      attempts: [
        makeAttempt({
          providerId: "outra-prova",
          result: { rows: [makeRow({ key: "x" })], correct: 1, total: 1, blank: 0 },
        }),
      ],
    });
    expect(officialRows(db)[0].providerId).toBe("outra-prova");
  });

  it("não mistura linhas de provas diferentes", () => {
    const db = dbMisto();
    expect(officialRowsOf(db, "enem").map((r) => r.key)).toEqual(["l1", "l2"]);
    expect(officialRowsOf(db, "outra-prova").map((r) => r.key)).toEqual(["o1", "o2"]);
  });

  it("lista as provas presentes no histórico", () => {
    expect(providersInHistory(dbMisto())).toEqual(["enem", "outra-prova"]);
  });

  it("estatística de área é escopada por prova, e ENEM é o padrão", () => {
    const db = dbMisto();
    // O padrão é ENEM: as duas linhas da outra prova ficam de fora.
    expect(areaStats(db).matematica).toEqual({ c: 1, t: 2 });
    // A outra prova tem os próprios números, no mesmo nome de área.
    expect(areaStats(db, "outra-prova").matematica).toEqual({ c: 0, t: 2 });
  });
});

describe("domínio não mistura provas", () => {
  it("linha de outra banca não entra no mapa de domínio do ENEM", () => {
    const db = makeDB({
      attempts: [
        makeAttempt({
          id: "a_enem",
          result: {
            rows: [makeRow({ key: "e1", content: "Funções", isCorrect: true })],
            correct: 1,
            total: 1,
            blank: 0,
          },
        }),
        makeAttempt({
          id: "a_ita",
          providerId: "ita",
          result: {
            rows: [
              makeRow({
                key: "i1",
                providerId: "ita",
                content: "Funções",
                isCorrect: false,
              }),
            ],
            correct: 0,
            total: 1,
            blank: 0,
          },
        }),
      ],
    });

    // Sem escopo, o erro do ITA derrubaria o domínio de "Funções" do ENEM.
    expect(masteryStats(db).Funções).toEqual({ c: 1, t: 1 });
    expect(masteryStats(db, "ita").Funções).toEqual({ c: 0, t: 1 });
    // O escopo nulo é o único jeito de ver tudo junto, e é explícito.
    expect(masteryStats(db, null).Funções).toEqual({ c: 1, t: 2 });
  });
});
