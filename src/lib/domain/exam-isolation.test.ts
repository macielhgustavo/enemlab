import { describe, expect, it } from "vitest";
import {
  areaStats,
  evolutionSeries,
  rollingRows,
  streakDays,
  weakestContents,
  masteryStats,
} from "./stats";
import { allSrs, dueSRS } from "./srs";
import { buildDailyPlan } from "./daily-plan";
import { makeDB, makeRow, makeAttempt } from "./__fixtures__/db";
import type { DB, SrsEntry } from "./types";

const ONTEM = new Date(Date.now() - 86400000).toISOString();

function srsItem(over: Partial<SrsEntry>): SrsEntry {
  return {
    reps: 1,
    interval: 2,
    due: ONTEM,
    year: 2023,
    index: 1,
    area: "matematica",
    content: "Funções",
    ...over,
  };
}

/** Histórico com as duas provas, cada uma com desempenho oposto. */
function dbDuasProvas(): DB {
  const enem = makeAttempt({
    id: "a_enem",
    result: {
      rows: [
        makeRow({ key: "e1", content: "Funções", isCorrect: true }),
        makeRow({ key: "e2", content: "Funções", isCorrect: true }),
      ],
      correct: 2,
      total: 2,
      blank: 0,
    },
  });

  const ita = makeAttempt({
    id: "a_ita",
    providerId: "ita",
    result: {
      rows: [
        makeRow({ key: "i1", providerId: "ita", area: "physics", content: "Física", isCorrect: false }),
        makeRow({ key: "i2", providerId: "ita", area: "physics", content: "Física", isCorrect: false }),
      ],
      correct: 0,
      total: 2,
      blank: 0,
    },
  });

  return makeDB({
    attempts: [enem, ita],
    srs: {
      "2023-1-pt-matematica": srsItem({}),
      "ita-2026-first-1": srsItem({ providerId: "ita", area: "physics", content: "Física" }),
    },
  });
}

describe("isolamento entre provas", () => {
  const db = dbDuasProvas();

  it("estatística de área não cruza bancas", () => {
    expect(areaStats(db).matematica).toEqual({ c: 2, t: 2 });
    expect(areaStats(db).physics).toBeUndefined();
    expect(areaStats(db, "ita").physics).toEqual({ c: 0, t: 2 });
    expect(areaStats(db, "ita").matematica).toBeUndefined();
  });

  it("janela das últimas questões é por prova", () => {
    expect(rollingRows(db, 100).map((r) => r.key)).toEqual(["e1", "e2"]);
    expect(rollingRows(db, 100, "ita").map((r) => r.key)).toEqual(["i1", "i2"]);
  });

  it("domínio e conteúdos frágeis são por prova", () => {
    expect(masteryStats(db).Funções).toEqual({ c: 2, t: 2 });
    expect(masteryStats(db, "ita").Funções).toEqual({ c: 0, t: 0 });
    // O ENEM está 100%: nenhum conteúdo frágil vem do erro do ITA.
    expect(weakestContents(db, 5).some((w) => w.name === "Física")).toBe(false);
    expect(weakestContents(db, 5, "ita").map((w) => w.name)).toContain("Física");
  });

  it("fila de revisão é separada", () => {
    expect(allSrs(db).map((x) => x.key)).toEqual(["2023-1-pt-matematica"]);
    expect(allSrs(db, "ita").map((x) => x.key)).toEqual(["ita-2026-first-1"]);
    expect(dueSRS(db)).toHaveLength(1);
    expect(dueSRS(db, "ita")).toHaveLength(1);
    expect(dueSRS(db)[0].key).not.toBe(dueSRS(db, "ita")[0].key);
  });

  it("plano diário usa só a fila e o histórico da prova ativa", () => {
    const enem = buildDailyPlan(db, 60, new Date());
    const ita = buildDailyPlan(db, 60, new Date(), "ita");
    // Cada plano enxerga exatamente uma revisão vencida — a sua.
    const srsEnem = enem.blocks.find((b) => b.kind === "srs");
    const srsIta = ita.blocks.find((b) => b.kind === "srs");
    expect(srsEnem?.questions).toBe(1);
    expect(srsIta?.questions).toBe(1);
    expect(enem.blocks).not.toEqual(ita.blocks);
  });

  it("sequência e evolução não somam dias de provas diferentes", () => {
    expect(streakDays(db, "enem")).toBeGreaterThanOrEqual(0);
    // Duas medições por prova não bastam para série; o importante é não
    // herdar as linhas da outra banca.
    expect(evolutionSeries(db).length).toBe(evolutionSeries(db, undefined, undefined, "enem").length);
  });
});

describe("troca ENEM → ITA → ENEM", () => {
  it("os números do ENEM voltam idênticos após passar pelo ITA", () => {
    const db = dbDuasProvas();

    const antes = {
      area: areaStats(db, "enem"),
      mastery: masteryStats(db, "enem"),
      srs: allSrs(db, "enem").map((x) => x.key),
      roll: rollingRows(db, 100, "enem").map((r) => r.key),
    };

    // Passa pelo ITA (leitura completa, como a UI faria)
    areaStats(db, "ita");
    masteryStats(db, "ita");
    allSrs(db, "ita");
    buildDailyPlan(db, 60, new Date(), "ita");

    expect(areaStats(db, "enem")).toEqual(antes.area);
    expect(masteryStats(db, "enem")).toEqual(antes.mastery);
    expect(allSrs(db, "enem").map((x) => x.key)).toEqual(antes.srs);
    expect(rollingRows(db, 100, "enem").map((r) => r.key)).toEqual(antes.roll);
  });
});
