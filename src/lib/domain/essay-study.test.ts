import { describe, expect, it } from "vitest";
import { makeDB } from "./__fixtures__/db";
import {
  createEssayPractice,
  essayCompetencyProgress,
  essayPractices,
  finishEssayPractice,
  nextEssayAction,
  recordEssayEvaluation,
  saveEssayVersion,
} from "./essay-study";

describe("essay study", () => {
  it("cria redação independente de tentativa objetiva e mantém versões", () => {
    const essay = createEssayPractice({
      providerId: "enem",
      theme: "Tema de teste",
      timeLimitMin: 90,
      now: "2026-09-27T10:00:00.000Z",
    });

    saveEssayVersion(essay, {
      text: "Primeira versão",
      elapsedSec: 600,
      now: "2026-09-27T10:10:00.000Z",
    });
    finishEssayPractice(essay, {
      text: "Versão final",
      repertoire: "Repertório próprio",
      improvements: "Melhorar a conclusão",
      elapsedSec: 1200,
      now: "2026-09-27T10:20:00.000Z",
    });

    expect(essay.text).toBe("Versão final");
    expect(essay.versions).toHaveLength(2);
    expect(essay.elapsedSec).toBe(1200);
    expect(essay.finishedAt).toBe("2026-09-27T10:20:00.000Z");
  });

  it("calcula competência somente a partir de avaliações registradas", () => {
    const db = makeDB();
    const essay = createEssayPractice({
      providerId: "enem",
      theme: "Tema",
      now: "2026-09-27T10:00:00.000Z",
    });
    recordEssayEvaluation(essay, {
      source: "self",
      competencies: { c1: 160, c2: 120 },
      now: "2026-09-27T11:00:00.000Z",
    });
    recordEssayEvaluation(essay, {
      source: "external",
      authorLabel: "Professor",
      competencies: { c1: 200, c2: 160 },
      feedback: "Revisar repertório.",
      now: "2026-09-27T12:00:00.000Z",
    });
    db.essays = [essay];

    const metrics = essayCompetencyProgress(db, "enem");
    expect(metrics.find((metric) => metric.id === "c1")).toMatchObject({
      average: 180,
      samples: 2,
    });
    expect(metrics.find((metric) => metric.id === "c3")).toMatchObject({
      average: null,
      samples: 0,
    });
    expect(essay.evaluations[1].authorLabel).toBe("Professor");
  });

  it("preserva histórico por provider e sugere ação transparente", () => {
    const db = makeDB();
    const essay = createEssayPractice({
      providerId: "enem",
      theme: "Tema",
      now: "2026-09-27T10:00:00.000Z",
    });
    finishEssayPractice(essay, {
      text: "Texto final",
      now: "2026-09-27T11:00:00.000Z",
    });
    recordEssayEvaluation(essay, {
      source: "self",
      competencies: { c1: 160, c2: 80, c3: 120, c4: 160, c5: 120 },
      now: "2026-09-27T12:00:00.000Z",
    });
    db.essays = [essay];

    expect(essayPractices(db, "enem")).toHaveLength(1);
    expect(essayPractices(db, "ita")).toHaveLength(0);
    expect(nextEssayAction(db, "enem")).toMatchObject({
      kind: "competency",
      competencyId: "c2",
    });
  });
});
