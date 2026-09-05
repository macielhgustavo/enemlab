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
