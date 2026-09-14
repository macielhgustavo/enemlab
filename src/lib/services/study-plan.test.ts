import { describe, expect, it } from "vitest";
import { makeAttempt, makeDB, makeRow } from "../domain/__fixtures__/db";
import { studyPlan } from "./study-plan";

function attemptWithRows(providerId: string, rows: ReturnType<typeof makeRow>[]) {
  return makeAttempt({
    providerId,
    result: {
      rows,
      correct: rows.filter((row) => row.isCorrect).length,
      total: rows.length,
      blank: 0,
    },
  });
}

describe("study plan explainability", () => {
  it("marca retenção como etapa ativa quando há revisão vencida", () => {
    const db = makeDB({
      srs: {
        "unesp-2026-first-1": {
          providerId: "unesp",
          reps: 0,
          interval: 0,
          due: "2020-01-01T00:00:00.000Z",
          year: 2026,
          index: 1,
          area: "linguagens",
          content: "Leitura",
          language: null,
        },
      },
    });
    const plan = studyPlan(db, "unesp");
    expect(plan.find((step) => step.kind === "review")?.active).toBe(true);
    expect(plan.filter((step) => step.active)).toHaveLength(1);
  });

  it("mostra lacuna abaixo de 65% como próxima etapa depois da retenção", () => {
    const rows = [
      makeRow({ key: "u1", providerId: "unesp", content: "Funções", isCorrect: false }),
      makeRow({ key: "u2", providerId: "unesp", content: "Funções", isCorrect: true }),
      makeRow({ key: "u3", providerId: "unesp", content: "Funções", isCorrect: false }),
    ];
    const plan = studyPlan(makeDB({ attempts: [attemptWithRows("unesp", rows)] }), "unesp");
    const weakness = plan.find((step) => step.kind === "weakness");
    expect(weakness?.active).toBe(true);
    expect(weakness?.detail).toContain("Funções");
  });

  it("sem histórico ativa nova amostra inédita", () => {
    const plan = studyPlan(makeDB(), "unesp");
    expect(plan.at(-1)?.kind).toBe("unseen");
    expect(plan.at(-1)?.active).toBe(true);
  });

  it("com histórico limpo ativa avanço adaptativo", () => {
    const rows = [
      makeRow({ key: "u1", providerId: "unesp", content: "Funções", isCorrect: true }),
      makeRow({ key: "u2", providerId: "unesp", content: "Funções", isCorrect: true }),
    ];
    const plan = studyPlan(makeDB({ attempts: [attemptWithRows("unesp", rows)] }), "unesp");
    expect(plan.at(-1)?.kind).toBe("adaptive");
    expect(plan.at(-1)?.active).toBe(true);
  });
});
