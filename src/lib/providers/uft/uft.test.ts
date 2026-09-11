import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { uftAnswerKey, uftProvider } from "./index";
import { applyNativeBundle } from "../../native/bundle";
import { buildCurrentCatalog } from "../../catalog/current";
import { referenceQuestionsForKey } from "../vestibular-reference";
import { importerForProvider, sourcesForProvider } from "../../sources";

const candidate = JSON.parse(readFileSync("data/native/uft-2025-1.json", "utf8"));

describe("UFT native pilot", () => {
  it("keeps all 44 official numbers, four alternatives and annulment 28", async () => {
    const base = await uftProvider.fetchQuestions({ year: 2025 });
    expect(base).toHaveLength(44);
    expect(base.map((question) => question.number)).toEqual(
      Array.from({ length: 44 }, (_, index) => index + 1),
    );
    expect(
      base.every(
        (question) => question.alternatives.map((alt) => alt.letter).join("") === "ABCD",
      ),
    ).toBe(true);
    expect(base[27].correctAlternative).toBeNull();
    expect(base[34].correctAlternative).toBe("C");
    expect(base.every((question) => question.statementAvailable === false)).toBe(true);
    expect(await uftProvider.fetchQuestions({ year: 2024 })).toEqual([]);
    expect(await uftProvider.fetchQuestions({ year: 2025, editionId: "2025-2" })).toEqual([]);
  });

  it("publishes only reviewed texts without changing answers or keys", async () => {
    const base = await uftProvider.fetchQuestions({ year: 2025 });
    const native = applyNativeBundle(base, candidate);
    expect(
      native
        .filter((question) => question.statementAvailable)
        .map((question) => question.number),
    ).toEqual([29, 31, 32, 33, 34, 35, 37, 38, 40, 41, 42, 43]);
    expect(native.map(uftProvider.questionKey)).toEqual(base.map(uftProvider.questionKey));
    expect(native.map((question) => question.correctAlternative)).toEqual(
      base.map((question) => question.correctAlternative),
    );
    expect(applyNativeBundle(native, candidate)).toEqual(native);
    expect(new Set(native.map(uftProvider.questionKey)).size).toBe(44);
    expect(
      native.every((question) =>
        uftProvider.questionKey(question).startsWith("uft-2025-1-afternoon-"),
      ),
    ).toBe(true);
    expect(native[28].context).toContain("modelos atômicos");
    expect(native[28].sources.some((source) => source.label.includes("CC BY-ND"))).toBe(true);
    expect(native[36].alternatives[1].text).toBe("Glândulas sebáceas.");
    expect(native[42].alternatives[2].text).toContain("Caatinga");
    expect(native[42].correctAlternative).toBe("C");
    expect(() => applyNativeBundle(base, { ...candidate, providerId: "ita" })).toThrow();
  });

  it("reports partial coverage honestly and associates the source with the afternoon", () => {
    expect(buildCurrentCatalog().query({ providerId: "uft" })).toEqual([
      expect.objectContaining({
        year: 2025,
        editionId: "2025-1",
        phase: "afternoon",
        questionCount: 44,
        nativeQuestionCount: 12,
        contentMode: "hybrid",
        statementAvailable: false,
      }),
    ]);
    expect(sourcesForProvider("uft")).toHaveLength(1);
    expect(importerForProvider("uft")?.provenanceFor(2025, "afternoon").documentUrl).toBe(
      uftAnswerKey("2025-1")?.examUrl,
    );
    expect(importerForProvider("uft")?.provenanceFor(2025, "morning").documentUrl).not.toBe(
      uftAnswerKey("2025-1")?.examUrl,
    );
  });

  it("rejects a letter set incompatible with the official key", () => {
    const key = uftAnswerKey("2025-1")!;
    expect(() =>
      referenceQuestionsForKey(
        {
          id: "uft",
          institution: "UFT",
          metadata: uftProvider.metadata,
          keys: {},
          alternativeLetters: ["A", "B"],
        },
        key,
      ),
    ).toThrow(/alternativas/);
  });
});
