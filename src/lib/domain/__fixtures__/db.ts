// Fixtures compartilhadas pelos testes de domínio.
import { FINAL_BUILD, FINAL_SCHEMA } from "../constants";
import type { Attempt, DB, ResultRow } from "../types";

export function makeDB(over: Partial<DB> = {}): DB {
  return {
    v: 6,
    schema: FINAL_SCHEMA,
    build: FINAL_BUILD,
    theme: "light",
    attempts: [],
    notes: {},
    srs: {},
    sessions: [],
    goals: { questions: 150, essays: 1, reviews: 60 },
    lastOpened: null,
    lastBackupAt: null,
    ...over,
  };
}

export function makeRow(over: Partial<ResultRow> = {}): ResultRow {
  return {
    key: "2023-1",
    index: 1,
    year: 2023,
    area: "matematica",
    language: null,
    content: "Porcentagem e juros",
    selected: "A",
    correct: "A",
    isCorrect: true,
    confidence: null,
    timeSec: 60,
    flagged: false,
    finishedAt: "2026-01-10T12:00:00.000Z",
    ...over,
  };
}

export function makeAttempt(over: Partial<Attempt> = {}): Attempt {
  const rows = over.result?.rows ?? [makeRow()];
  return {
    id: "a_1",
    year: 2023,
    lang: "ingles",
    mode: "sprint15",
    area: "matematica",
    minutes: 50,
    startedAt: "2026-01-10T11:00:00.000Z",
    finishedAt: "2026-01-10T12:00:00.000Z",
    questionRefs: [],
    answers: {},
    flags: {},
    confidence: {},
    times: {},
    elapsed: 600,
    result: {
      rows,
      correct: rows.filter((r) => r.isCorrect).length,
      total: rows.length,
      blank: rows.filter((r) => !r.selected).length,
    },
    ...over,
  } as Attempt;
}

// Monta um db com uma tentativa corrigida a partir das linhas dadas.
export function dbWithRows(rows: ResultRow[], over: Partial<DB> = {}): DB {
  return makeDB({ attempts: [makeAttempt({ result: { rows, correct: rows.filter((r) => r.isCorrect).length, total: rows.length, blank: 0 } })], ...over });
}
