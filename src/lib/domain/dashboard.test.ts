import { describe, expect, it } from "vitest";
import {
  buildDashboardModel,
  dashboardGreeting,
  dashboardRelativeTime,
  dashboardSparklinePoints,
} from "./dashboard";
import { makeAttempt, makeDB } from "./__fixtures__/db";

describe("dashboard domain model", () => {
  it("mantém a saudação por faixa horária", () => {
    expect(dashboardGreeting(2)).toBe("Boa madrugada");
    expect(dashboardGreeting(9)).toBe("Bom dia");
    expect(dashboardGreeting(15)).toBe("Boa tarde");
    expect(dashboardGreeting(21)).toBe("Boa noite");
  });

  it("formata tempo relativo sem depender do componente", () => {
    const now = new Date("2026-09-22T12:00:00.000Z");
    expect(dashboardRelativeTime("2026-09-22T11:30:00.000Z", now)).toBe("agora há pouco");
    expect(dashboardRelativeTime("2026-09-22T08:00:00.000Z", now)).toBe("há 4h");
    expect(dashboardRelativeTime("2026-09-20T12:00:00.000Z", now)).toBe("há 2 dias");
  });

  it("gera os mesmos pontos do sparkline de forma determinística", () => {
    expect(dashboardSparklinePoints([])).toBeNull();
    expect(dashboardSparklinePoints([0, 10])).toBe("0.0,27.0 96.0,5.0");
  });

  it("usa calibração como missão de um histórico vazio", () => {
    const model = buildDashboardModel(
      makeDB({ activeProvider: "enem" }),
      "enem",
      new Date("2026-09-22T12:00:00.000Z"),
    );

    expect(model.mission).toMatchObject({
      eyebrow: "calibração",
      href: "/practice",
      cta: "Montar treino",
    });
    expect(model.completedCount).toBe(0);
    expect(model.recentAccuracy).toBeNull();
    expect(model.totalQuestions).toBe(0);
  });

  it("prioriza uma sessão em andamento acima das demais ações", () => {
    const openAttempt = makeAttempt({
      id: "open_1",
      providerId: "enem",
      year: 2025,
      finishedAt: null,
      result: undefined,
      questionRefs: [
        { providerId: "enem", year: 2025, index: 1, discipline: "matematica" },
        { providerId: "enem", year: 2025, index: 2, discipline: "matematica" },
      ],
      answers: { "enem-2025-1": "A" },
    });
    const model = buildDashboardModel(
      makeDB({ activeProvider: "enem", attempts: [openAttempt] }),
      "enem",
      new Date("2026-09-22T12:00:00.000Z"),
    );

    expect(model.mission).toMatchObject({
      eyebrow: "sessão em andamento",
      title: "Retomar ENEM 2025",
      href: "/exam/open_1",
      cta: "Continuar sessão",
    });
    expect(model.mission.description).toBe("1 de 2 respondidas");
  });
});
