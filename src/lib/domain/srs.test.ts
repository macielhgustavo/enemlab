import { describe, expect, it } from "vitest";
import { updateSRS, dueSRS, allSrs } from "./srs";
import { SRS_INTERVALS } from "./constants";
import { makeDB, makeRow, makeAttempt } from "./__fixtures__/db";
import type { SrsEntry } from "./types";

const DAY = 86400000;

describe("updateSRS", () => {
  it("ignora linhas sem gabarito", () => {
    const db = makeDB();
    updateSRS(db, makeRow({ correct: null, isCorrect: null }), makeAttempt());
    expect(db.srs).toEqual({});
  });

  it("não enfileira acerto na primeira exposição", () => {
    const db = makeDB();
    updateSRS(db, makeRow({ key: "k1", isCorrect: true }), makeAttempt());
    expect(db.srs).toEqual({});
  });

  it("enfileira erro para revisão em ~6h e zera as repetições", () => {
    const db = makeDB();
    const before = Date.now();
    updateSRS(db, makeRow({ key: "k1", isCorrect: false, selected: "B" }), makeAttempt());

    const entry = db.srs.k1;
    expect(entry).toBeDefined();
    expect(entry.reps).toBe(0);
    expect(entry.interval).toBe(0);
    expect(entry.lastResult).toBe("wrong");
    const delta = new Date(entry.due).getTime() - before;
    expect(delta).toBeGreaterThan(5.5 * 3600000);
    expect(delta).toBeLessThan(6.5 * 3600000);
  });

  it("promove o intervalo a cada acerto de item já enfileirado", () => {
    const db = makeDB();
    // erra uma vez para entrar na fila
    updateSRS(db, makeRow({ key: "k1", isCorrect: false }), makeAttempt());
    // primeiro acerto: reps 1 → intervalo de 2 dias
    updateSRS(db, makeRow({ key: "k1", isCorrect: true }), makeAttempt());
    expect(db.srs.k1.reps).toBe(1);
    expect(db.srs.k1.interval).toBe(SRS_INTERVALS[1]);

    // segundo acerto: reps 2 → 7 dias
    updateSRS(db, makeRow({ key: "k1", isCorrect: true }), makeAttempt());
    expect(db.srs.k1.reps).toBe(2);
    expect(db.srs.k1.interval).toBe(SRS_INTERVALS[2]);
    const dias = (new Date(db.srs.k1.due).getTime() - Date.now()) / DAY;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);
  });

  it("satura o intervalo no teto da tabela", () => {
    const db = makeDB();
    updateSRS(db, makeRow({ key: "k1", isCorrect: false }), makeAttempt());
    for (let i = 0; i < 8; i++) {
      updateSRS(db, makeRow({ key: "k1", isCorrect: true }), makeAttempt());
    }
    expect(db.srs.k1.interval).toBe(SRS_INTERVALS[5]);
  });

  it("recomeça do zero quando o item volta a ser errado", () => {
    const db = makeDB();
    updateSRS(db, makeRow({ key: "k1", isCorrect: false }), makeAttempt());
    updateSRS(db, makeRow({ key: "k1", isCorrect: true }), makeAttempt());
    updateSRS(db, makeRow({ key: "k1", isCorrect: false }), makeAttempt());
    expect(db.srs.k1.reps).toBe(0);
    expect(db.srs.k1.interval).toBe(0);
    expect(db.srs.k1.lastResult).toBe("wrong");
  });
});

describe("filas de revisão", () => {
  const entry = (over: Partial<SrsEntry>): SrsEntry => ({
    reps: 1,
    interval: 2,
    due: new Date().toISOString(),
    year: 2023,
    index: 1,
    area: "matematica",
    ...over,
  });

  it("dueSRS traz só o que venceu, do mais antigo ao mais recente", () => {
    const db = makeDB({
      srs: {
        futura: entry({ due: new Date(Date.now() + 2 * DAY).toISOString() }),
        antiga: entry({ due: new Date(Date.now() - 2 * DAY).toISOString() }),
        recente: entry({ due: new Date(Date.now() - 1 * DAY).toISOString() }),
      },
    });
    expect(dueSRS(db).map((x) => x.key)).toEqual(["antiga", "recente"]);
    expect(allSrs(db)).toHaveLength(3);
  });
});
