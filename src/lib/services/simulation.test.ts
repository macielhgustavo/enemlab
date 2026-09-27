import { describe, expect, it } from "vitest";
import {
  buildSimulationAttempt,
  simulationEntriesForProvider,
  simulationTiming,
} from "./simulation";

describe("simulation mode", () => {
  it("expõe blocos validados do provider em ordem previsível", () => {
    const entries = simulationEntriesForProvider("udesc");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].year).toBeGreaterThanOrEqual(entries.at(-1)!.year);
    expect(entries.every((entry) => entry.providerId === "udesc")).toBe(true);
    expect(entries.every((entry) => entry.validation === "verified" || entry.validation === "reviewed")).toBe(true);
  });

  it("mantém durações já configuradas e identifica estimativa interna", () => {
    expect(
      simulationTiming({
        providerId: "enem",
        phase: "day1",
        questionCount: null,
      }).minutes,
    ).toBe(330);
    expect(
      simulationTiming({
        providerId: "ita",
        phase: "first",
        questionCount: 48,
      }).minutes,
    ).toBe(240);
    expect(
      simulationTiming({
        providerId: "udesc",
        phase: "morning",
        questionCount: 50,
      }),
    ).toEqual({ minutes: 150, basis: "internal-estimate" });
  });

  it("constrói uma tentativa estrita do bloco exato sem misturar sessões", async () => {
    const entry = simulationEntriesForProvider("udesc")[0];
    const attempt = await buildSimulationAttempt(entry);

    expect(attempt.mode).toBe("simulado");
    expect(attempt.providerId).toBe("udesc");
    expect(attempt.strict).toBe(true);
    expect(attempt.alerts).toBe(false);
    expect(attempt.questionRefs).toHaveLength(entry.questionCount!);
    expect(attempt.questionRefs.every((ref) => ref.editionId === entry.editionId)).toBe(true);
    expect(attempt.questionRefs.every((ref) => ref.phase === entry.phase)).toBe(true);
    expect(attempt.simulation).toMatchObject({
      editionId: entry.editionId,
      phase: entry.phase,
      questionCount: entry.questionCount,
    });
  });
});
