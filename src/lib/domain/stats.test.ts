import { describe, expect, it } from "vitest";
import {
  wilsonInterval,
  statisticalConfidence,
  contentMasteryState,
  weakestContents,
  areaStats,
  officialRows,
  streakDays,
  evolutionSeries,
} from "./stats";
import { makeDB, makeRow, dbWithRows } from "./__fixtures__/db";
import type { SrsEntry } from "./types";

describe("wilsonInterval", () => {
  it("devolve o intervalo total quando não há amostra", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 100, width: 100 });
  });

  it("calcula o intervalo de 8/10 conforme a fórmula de Wilson", () => {
    expect(wilsonInterval(8, 10)).toEqual({ low: 49, high: 94, width: 45 });
  });

  it("mantém os limites dentro de 0..100", () => {
    const perfect = wilsonInterval(10, 10);
    const zero = wilsonInterval(0, 10);
    expect(perfect.high).toBe(100);
    expect(zero.low).toBe(0);
  });

  it("estreita o intervalo conforme a amostra cresce", () => {
    expect(wilsonInterval(80, 100).width).toBeLessThan(wilsonInterval(8, 10).width);
  });
});

describe("statisticalConfidence", () => {
  it("reporta ausência de amostra", () => {
    expect(statisticalConfidence(0, 0).label).toBe("sem amostra");
  });

  it("classifica amostra grande e consistente como alta", () => {
    expect(statisticalConfidence(90, 100).label).toBe("alta");
  });

  it("classifica amostra mínima como baixa", () => {
    expect(statisticalConfidence(1, 2).label).toBe("baixa");
  });
});

describe("contentMasteryState", () => {
  const db = makeDB();

  it("separa 'não testado' de amostra insuficiente", () => {
    expect(contentMasteryState(db, "X", { c: 0, t: 0 })).toMatchObject({
      cls: "untested",
      label: "não testado",
      p: null,
    });
    expect(contentMasteryState(db, "X", { c: 3, t: 3 })).toMatchObject({
      cls: "untested",
      label: "amostra insuficiente",
    });
  });

  it("marca amostra pequena como promissor ou instável", () => {
    expect(contentMasteryState(db, "X", { c: 4, t: 5 }).label).toBe("promissor");
    expect(contentMasteryState(db, "X", { c: 2, t: 5 }).label).toBe("instável");
  });

  it("só considera dominado com retenção alta no SRS", () => {
    const semRetencao = contentMasteryState(db, "Alvo", { c: 19, t: 20 });
    expect(semRetencao.label).not.toBe("dominado");

    const srs: Record<string, SrsEntry> = {
      k1: { reps: 2, interval: 7, due: "2026-01-01", year: 2023, index: 1, area: "matematica", content: "Alvo", lastResult: "correct" },
      k2: { reps: 3, interval: 15, due: "2026-01-01", year: 2023, index: 2, area: "matematica", content: "Alvo", lastResult: "correct" },
    };
    const comRetencao = contentMasteryState(makeDB({ srs }), "Alvo", { c: 19, t: 20 });
    expect(comRetencao).toMatchObject({ cls: "mastered", label: "dominado" });
  });

  it("classifica estável e fraco por faixa de acerto", () => {
    expect(contentMasteryState(db, "X", { c: 14, t: 20 }).label).toBe("estável");
    expect(contentMasteryState(db, "X", { c: 8, t: 20 }).label).toBe("fraco");
  });
});

describe("seletores sobre tentativas", () => {
  it("agrega acertos por área apenas de linhas com gabarito", () => {
    const db = dbWithRows([
      makeRow({ key: "a", isCorrect: true }),
      makeRow({ key: "b", isCorrect: false, selected: "B" }),
      makeRow({ key: "c", correct: null, isCorrect: null }),
    ]);
    expect(areaStats(db).matematica).toEqual({ c: 1, t: 2 });
    expect(officialRows(db)).toHaveLength(3);
  });

  it("ordena os conteúdos mais fracos primeiro", () => {
    const db = dbWithRows([
      makeRow({ key: "a", content: "Forte", isCorrect: true }),
      makeRow({ key: "b", content: "Forte", isCorrect: true }),
      makeRow({ key: "c", content: "Fraco", isCorrect: false }),
      makeRow({ key: "d", content: "Fraco", isCorrect: true }),
    ]);
    const weak = weakestContents(db, 2);
    expect(weak[0].name).toBe("Fraco");
    expect(weak[0].p).toBe(50);
  });

  it("conta sequência zero quando não há tentativas", () => {
    expect(streakDays(makeDB())).toBe(0);
  });

  it("gera série de evolução apenas com dados suficientes", () => {
    expect(evolutionSeries(makeDB())).toEqual([]);
  });
});
