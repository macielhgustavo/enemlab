import { describe, expect, it } from "vitest";
import {
  buildDailyPlan,
  estimatedQuestionMinutes,
  validationPriorities,
} from "./daily-plan";
import type {
  Attempt,
  DB,
  ResultRow,
  StudentAIAssistanceTrace,
} from "./types";

function db(): DB {
  return {
    v: 6,
    schema: 6,
    build: "test",
    theme: "dark",
    attempts: [],
    notes: {},
    srs: {},
    sessions: [],
    goals: { questions: 140, essays: 2, reviews: 30 },
    lastOpened: null,
    lastBackupAt: null,
  };
}

function row(index: number, content: string, correct: boolean, timeSec = 180): ResultRow {
  return {
    key: `2023|${index}`,
    index,
    year: 2023,
    area: "matematica",
    language: null,
    content,
    tags: [content],
    selected: correct ? "A" : "B",
    correct: "A",
    isCorrect: correct,
    confidence: correct ? "duvida" : "certeza",
    timeSec,
    flagged: false,
    finishedAt: "2026-09-02T12:00:00.000Z",
  };
}

function attempt(id: string, rows: ResultRow[], finishedAt: string, elapsed = 0): Attempt {
  return {
    id,
    year: 2023,
    lang: "ingles",
    mode: "sprint15",
    area: "all",
    minutes: 50,
    strict: false,
    questionRefs: [],
    answers: {},
    confidence: {},
    flags: {},
    timeQ: {},
    elapsed,
    startedAt: finishedAt,
    finishedAt,
    result: {
      rows,
      correct: rows.filter((r) => r.isCorrect).length,
      total: rows.length,
      blank: 0,
    },
    essay: null,
  };
}

function highAssistanceTrace(): StudentAIAssistanceTrace {
  return {
    requests: 2,
    maxLevel: 6,
    answerRevealed: true,
    modes: ["hint", "chat"],
    firstAt: "2026-09-02T11:30:00.000Z",
    lastAt: "2026-09-02T11:32:00.000Z",
    lastProvider: "mock",
    fallbackUsed: false,
    recent: [
      {
        at: "2026-09-02T11:32:00.000Z",
        mode: "chat",
        level: 6,
        answerRevealed: true,
        provider: "mock",
      },
    ],
  };
}

describe("buildDailyPlan", () => {
  it("uses an adaptive calibration block when there is no study history", () => {
    const plan = buildDailyPlan(db(), 60, new Date("2026-09-05T14:00:00"));
    expect(plan.blocks.length).toBeGreaterThan(0);
    expect(plan.blocks[0].kind).toBe("adaptive");
    expect(plan.totalMinutes).toBeLessThanOrEqual(plan.remainingMinutes);
    expect(plan.avgQuestionMinutes).toBe(3);
  });

  it("puts overdue SRS before statistically weak content", () => {
    const state = db();
    state.srs.old = {
      reps: 0,
      interval: 0,
      due: "2020-01-01T00:00:00.000Z",
      year: 2023,
      index: 1,
      area: "matematica",
      content: "Porcentagem",
      lastResult: "wrong",
    };
    const rows = [
      row(1, "Porcentagem", false),
      row(2, "Porcentagem", false),
      row(3, "Porcentagem", false),
      row(4, "Porcentagem", true),
      row(5, "Geometria", true),
      row(6, "Geometria", true),
    ];
    state.attempts.push(attempt("old", rows, "2026-09-02T12:00:00.000Z", 1200));

    const plan = buildDailyPlan(state, 90, new Date("2026-09-05T14:00:00"));
    expect(plan.blocks[0].kind).toBe("srs");
    expect(plan.blocks.some((block) => block.kind === "weak" && block.content === "Porcentagem")).toBe(true);
    expect(plan.signals.highConfidenceErrors).toBeGreaterThan(0);
  });

  it("prioritizes a short tutor-free validation when raw accuracy overstates independent evidence", () => {
    const state = db();
    const rows = [
      row(1, "Funções", true),
      row(2, "Funções", true),
      row(3, "Funções", true),
      row(4, "Funções", true),
      row(5, "Funções", true),
      row(6, "Funções", false),
    ];
    const history = attempt("assisted", rows, "2026-09-02T12:00:00.000Z");
    history.aiAssistance = {
      "2023|1": highAssistanceTrace(),
      "2023|2": highAssistanceTrace(),
      "2023|3": highAssistanceTrace(),
    };
    state.attempts.push(history);

    const priorities = validationPriorities(state);
    expect(priorities[0]).toMatchObject({
      name: "Funções",
      rawAccuracy: 83,
      independentAccuracy: 67,
      independentQuestions: 3,
      highAssistanceQuestions: 3,
      correctWithHighAssistance: 3,
    });

    const plan = buildDailyPlan(state, 60, new Date("2026-09-05T14:00:00"));
    expect(plan.signals.assistedTopicsToValidate).toBe(1);
    expect(plan.blocks[0]).toMatchObject({
      kind: "validation",
      content: "Funções",
      aiAllowed: false,
    });
    expect(plan.blocks[0].reason).toContain("Acerto bruto 83%");
    expect(plan.blocks[0].reason).toContain("67%");
    expect(
      plan.blocks.filter((block) => block.content === "Funções"),
    ).toHaveLength(1);
  });

  it("does not create validation from a tiny independent sample", () => {
    const state = db();
    const rows = [
      row(1, "Trigonometria", true),
      row(2, "Trigonometria", true),
      row(3, "Trigonometria", true),
      row(4, "Trigonometria", true),
    ];
    const history = attempt("tiny", rows, "2026-09-02T12:00:00.000Z");
    history.aiAssistance = {
      "2023|1": highAssistanceTrace(),
      "2023|2": highAssistanceTrace(),
      "2023|3": highAssistanceTrace(),
    };
    state.attempts.push(history);

    expect(validationPriorities(state)).toEqual([]);
    const plan = buildDailyPlan(state, 60, new Date("2026-09-05T14:00:00"));
    expect(plan.blocks.some((block) => block.kind === "validation")).toBe(false);
  });

  it("subtracts study time already spent today from the available budget", () => {
    const state = db();
    state.attempts.push(
      attempt("today", [row(1, "Funções", true)], "2026-09-05T12:00:00", 25 * 60),
    );
    const plan = buildDailyPlan(state, 30, new Date("2026-09-05T14:00:00"));
    expect(plan.signals.minutesToday).toBe(25);
    expect(plan.remainingMinutes).toBe(5);
    expect(plan.totalMinutes).toBe(0);
  });

  it("counts blocks already completed from the intelligent plan", () => {
    const state = db();
    const done = attempt("planned", [row(1, "Funções", true)], "2026-09-05T10:00:00", 600);
    done.plan = { source: "daily-plan", dateKey: "2026-09-05", blockId: "adaptive-2026-09-05" };
    state.attempts.push(done);
    const plan = buildDailyPlan(state, 60, new Date("2026-09-05T14:00:00"));
    expect(plan.signals.completedPlanBlocks).toBe(1);
  });
});

describe("estimatedQuestionMinutes", () => {
  it("uses the median recent question time and ignores extreme values", () => {
    const state = db();
    state.attempts.push(
      attempt(
        "times",
        [row(1, "A", true, 120), row(2, "A", true, 180), row(3, "A", true, 900)],
        "2026-09-02T12:00:00.000Z",
      ),
    );
    expect(estimatedQuestionMinutes(state)).toBe(2.5);
  });
});
