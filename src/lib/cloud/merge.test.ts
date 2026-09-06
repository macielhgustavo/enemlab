import { describe, expect, it } from "vitest";
import { mergeCloudDB } from "./merge";
import type { Attempt, DB } from "../domain/types";

function base(): DB {
  return {
    v: 6,
    schema: 6.6,
    build: "test",
    theme: "dark",
    attempts: [],
    notes: {},
    srs: {},
    sessions: [],
    goals: { questions: 150, essays: 2, reviews: 30 },
    lastOpened: null,
    lastBackupAt: null,
  };
}

function attempt(id: string, finished = false, answers = 0): Attempt {
  const map = Object.fromEntries(Array.from({ length: answers }, (_, i) => [`q${i}`, "A"]));
  return {
    id,
    year: 2023,
    lang: "ingles",
    mode: "sprint15",
    area: "all",
    minutes: 45,
    strict: false,
    questionRefs: [],
    answers: map,
    confidence: {},
    flags: {},
    timeQ: {},
    elapsed: 0,
    startedAt: "2026-09-01T12:00:00.000Z",
    finishedAt: finished ? "2026-09-01T13:00:00.000Z" : null,
    result: finished ? { rows: [], correct: 0, total: 0, blank: 0 } : null,
    essay: null,
  };
}

describe("mergeCloudDB", () => {
  it("keeps attempts that exist on only one device", () => {
    const local = base();
    const cloud = base();
    local.attempts = [attempt("local")];
    cloud.attempts = [attempt("cloud")];

    const merged = mergeCloudDB(local, cloud);
    expect(merged.attempts.map((x) => x.id).sort()).toEqual(["cloud", "local"]);
  });

  it("prefers the more complete version of the same attempt", () => {
    const local = base();
    const cloud = base();
    local.attempts = [attempt("same", true, 10)];
    cloud.attempts = [attempt("same", false, 3)];

    const merged = mergeCloudDB(local, cloud);
    expect(merged.attempts).toHaveLength(1);
    expect(merged.attempts[0].finishedAt).not.toBeNull();
    expect(Object.keys(merged.attempts[0].answers)).toHaveLength(10);
  });

  it("preserves conflicting note text instead of silently dropping one", () => {
    const local = base();
    const cloud = base();
    local.notes.q1 = { text: "anotação local", knew: "quase" };
    cloud.notes.q1 = { text: "anotação da nuvem", reason: "Conteúdo" };

    const merged = mergeCloudDB(local, cloud);
    expect(merged.notes.q1.text).toContain("anotação local");
    expect(merged.notes.q1.text).toContain("anotação da nuvem");
    expect(merged.notes.q1.reason).toBe("Conteúdo");
    expect(merged.notes.q1.knew).toBe("quase");
  });

  it("keeps the most advanced SRS entry", () => {
    const local = base();
    const cloud = base();
    local.srs.q1 = { reps: 4, interval: 30, due: "2026-10-01T00:00:00Z", year: 2023, index: 1, area: "matematica" };
    cloud.srs.q1 = { reps: 2, interval: 7, due: "2026-09-10T00:00:00Z", year: 2023, index: 1, area: "matematica" };

    expect(mergeCloudDB(local, cloud).srs.q1.reps).toBe(4);
  });
});

describe("merge com várias provas", () => {
  function tentativa(id: string, providerId: string | undefined, finished: string | null) {
    return {
      id,
      providerId,
      year: 2026,
      lang: "ingles",
      mode: "full",
      area: "all",
      minutes: 60,
      strict: false,
      questionRefs: [],
      answers: {},
      confidence: {},
      flags: {},
      timeQ: {},
      elapsed: 0,
      startedAt: "2026-09-01T10:00:00.000Z",
      finishedAt: finished,
      result: finished ? { rows: [], correct: 0, total: 0, blank: 0 } : null,
    } as unknown as DB["attempts"][number];
  }

  const base = (attempts: DB["attempts"], extra: Partial<DB> = {}) =>
    ({
      v: 6,
      schema: 6.6,
      build: "test",
      theme: "dark",
      attempts,
      notes: {},
      srs: {},
      sessions: [],
      goals: { questions: 150, essays: 2, reviews: 30 },
      lastOpened: null,
      lastBackupAt: null,
      ...extra,
    }) as DB;

  it("une tentativas de provas diferentes sem perder a origem", () => {
    const local = base([tentativa("a_enem", undefined, "2026-09-01T11:00:00.000Z")]);
    const cloud = base([tentativa("a_ita", "ita", "2026-09-02T11:00:00.000Z")]);

    const merged = mergeCloudDB(local, cloud);
    const ids = merged.attempts.map((a) => a.id).sort();
    expect(ids).toEqual(["a_enem", "a_ita"]);

    const ita = merged.attempts.find((a) => a.id === "a_ita")!;
    expect(ita.providerId).toBe("ita");
    // A tentativa legada continua sem carimbo — e é lida como ENEM depois.
    const legado = merged.attempts.find((a) => a.id === "a_enem")!;
    expect(legado.providerId).toBeUndefined();
  });

  it("a prova ativa é preferência do aparelho", () => {
    const local = base([], { activeProvider: "ita" });
    const cloud = base([], { activeProvider: "enem" });
    expect(mergeCloudDB(local, cloud).activeProvider).toBe("ita");
    // Sem escolha local, herda a da nuvem em vez de forçar ENEM.
    expect(mergeCloudDB(base([]), cloud).activeProvider).toBe("enem");
  });

  it("não deixa SRS do ITA colidir com o do ENEM", () => {
    const local = base([], {
      srs: { "2023-1-pt-matematica": { reps: 2, interval: 7, due: "2026-09-10", year: 2023, index: 1, area: "matematica" } },
    } as Partial<DB>);
    const cloud = base([], {
      srs: { "ita-2026-first-1": { reps: 1, interval: 2, due: "2026-09-11", year: 2026, index: 1, area: "mathematics", providerId: "ita" } },
    } as Partial<DB>);

    const merged = mergeCloudDB(local, cloud);
    expect(Object.keys(merged.srs).sort()).toEqual(["2023-1-pt-matematica", "ita-2026-first-1"]);
    expect(merged.srs["ita-2026-first-1"].providerId).toBe("ita");
  });
});
