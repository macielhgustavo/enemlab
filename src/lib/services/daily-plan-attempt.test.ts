import { describe, expect, it } from "vitest";
import type { DailyPlanBlock } from "../domain/daily-plan";
import { makeDB } from "../domain/__fixtures__/db";
import { classifyContent, questionKey } from "../domain/classify";
import { questionsFor } from "../providers/access";
import { buildDailyPlanBlockAttempt } from "./daily-plan-attempt";

function block(kind: DailyPlanBlock["kind"], over: Partial<DailyPlanBlock> = {}): DailyPlanBlock {
  return {
    id: `${kind}-test`,
    kind,
    priority: 1,
    title: "Teste",
    eyebrow: "teste",
    reason: "fixture",
    questions: 5,
    minutes: 20,
    ...over,
  };
}

function expectOnlyProvider(providerId: string, attempt: Awaited<ReturnType<typeof buildDailyPlanBlockAttempt>>) {
  expect(attempt.providerId).toBe(providerId);
  expect(attempt.questionRefs.length).toBeGreaterThan(0);
  expect(attempt.questionRefs.every((ref) => ref.providerId === providerId)).toBe(true);
}

describe("execução multi-prova do Plano Diário", () => {
  it("monta bloco Adaptive da UNESP sem cair no ENEM", async () => {
    const attempt = await buildDailyPlanBlockAttempt(makeDB(), block("adaptive"), "unesp");
    expect(attempt.mode).toBe("adaptive");
    expectOnlyProvider("unesp", attempt);
  });

  it("monta bloco inédito da UNESP sem cair no ENEM", async () => {
    const attempt = await buildDailyPlanBlockAttempt(makeDB(), block("unseen"), "unesp");
    expect(attempt.mode).toBe("unseen15");
    expectOnlyProvider("unesp", attempt);
  });

  it("monta bloco de conteúdo usando a taxonomia da prova ativa", async () => {
    const pool = await questionsFor("unesp", { year: 2026, language: "ingles" });
    const target = pool.find((question) => classifyContent(question) !== "Não classificado");
    expect(target).toBeTruthy();
    const content = classifyContent(target!);

    const attempt = await buildDailyPlanBlockAttempt(
      makeDB(),
      block("weak", { content, questions: 3 }),
      "unesp",
    );

    expect(attempt.mode).toBe("content");
    expectOnlyProvider("unesp", attempt);
  });

  it("resolve revisão UNESP pela identidade exata da questão", async () => {
    const pool = await questionsFor("unesp", { year: 2026, language: "ingles" });
    const target = pool[0];
    expect(target).toBeTruthy();
    const key = questionKey(target);
    const db = makeDB({
      srs: {
        [key]: {
          providerId: "unesp",
          reps: 0,
          interval: 0,
          due: "2020-01-01T00:00:00.000Z",
          year: target.year,
          index: target.index,
          area: typeof target.discipline === "string" ? target.discipline : "",
          content: classifyContent(target),
          language: target.language,
        },
      },
    });

    const attempt = await buildDailyPlanBlockAttempt(db, block("srs", { questions: 1 }), "unesp");
    expect(attempt.mode).toBe("srs");
    expectOnlyProvider("unesp", attempt);
    expect(attempt.questionRefs[0].questionKey).toBe(key);
  });
});
