import { describe, expect, it } from "vitest";
import { makeAttempt, makeDB, makeRow } from "./__fixtures__/db";
import { buildDiagnosticSelection } from "./diagnostic";
import type { Question } from "./types";

function question(index: number, content: string, providerId = "enem"): Question {
  return {
    providerId,
    index,
    year: 2026,
    phase: "first",
    discipline: "matematica",
    correctAlternative: "A",
    classificationSnapshot: {
      primary: content,
      tags: [content],
      path: [content],
      subtopic: null,
      confidence: "alta",
      score: 10,
      margin: 5,
      evidence: ["fixture"],
    },
  };
}

function history(content: string, count: number) {
  const rows = Array.from({ length: count }, (_, index) =>
    makeRow({
      key: `history-${content}-${index}`,
      index: index + 1,
      content,
      tags: [content],
      selected: index % 4 === 0 ? "B" : "A",
      correct: "A",
      isCorrect: index % 4 !== 0,
      finishedAt: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    }),
  );
  return makeAttempt({
    id: `history-${content}`,
    result: { rows, correct: rows.filter((row) => row.isCorrect).length, total: rows.length, blank: 0 },
  });
}

describe("diagnostic selection", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("prefers untested contents over already calibrated contents", () => {
    const calibrated = "Funções";
    const unknown = "Estatística";
    const bank = [
      ...Array.from({ length: 15 }, (_, index) => question(index + 1, calibrated)),
      ...Array.from({ length: 15 }, (_, index) => question(index + 101, unknown)),
    ];
    const db = makeDB({ attempts: [history(calibrated, 12)] });
    const diagnostic = buildDiagnosticSelection(db, bank, "enem", 20, now);
    expect(diagnostic.selected[0].content).toBe(unknown);
    expect(diagnostic.untested).toBeGreaterThan(0);
    expect(diagnostic.note).toMatch(/não é nota prevista/i);
  });

  it("keeps broad content diversity when the bank allows it", () => {
    const contents = Array.from({ length: 10 }, (_, index) => `Tema ${index}`);
    const bank = contents.flatMap((content, contentIndex) =>
      Array.from({ length: 4 }, (_, index) => question(contentIndex * 10 + index + 1, content)),
    );
    const diagnostic = buildDiagnosticSelection(makeDB(), bank, "enem", 25, now);
    expect(diagnostic.selected).toHaveLength(25);
    expect(diagnostic.contents).toBeGreaterThanOrEqual(7);
    const counts = new Map<string, number>();
    diagnostic.selected.forEach((item) => counts.set(item.content, (counts.get(item.content) ?? 0) + 1));
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(5);
  });

  it("clamps requested size to the diagnostic 20–30 window", () => {
    const bank = Array.from({ length: 40 }, (_, index) => question(index + 1, `Tema ${index % 8}`));
    expect(buildDiagnosticSelection(makeDB(), bank, "enem", 5, now).requested).toBe(20);
    expect(buildDiagnosticSelection(makeDB(), bank, "enem", 99, now).requested).toBe(30);
  });

  it("never selects questions from another provider", () => {
    const enem = Array.from({ length: 25 }, (_, index) => question(index + 1, `ENEM ${index % 5}`, "enem"));
    const unesp = Array.from({ length: 25 }, (_, index) => question(index + 1, `UNESP ${index % 5}`, "unesp"));
    const diagnostic = buildDiagnosticSelection(makeDB(), [...enem, ...unesp], "unesp", 20, now);
    expect(diagnostic.selected).toHaveLength(20);
    expect(diagnostic.selected.every((item) => item.question.providerId === "unesp")).toBe(true);
  });

  it("is deterministic for a fixed state", () => {
    const bank = Array.from({ length: 30 }, (_, index) => question(index + 1, `Tema ${index % 6}`));
    const first = buildDiagnosticSelection(makeDB(), bank, "enem", 25, now).selected.map((item) => item.questionKey);
    const second = buildDiagnosticSelection(makeDB(), bank, "enem", 25, now).selected.map((item) => item.questionKey);
    expect(second).toEqual(first);
  });
});
