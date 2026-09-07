import { describe, expect, it } from "vitest";
import { afaAnswerKey, afaFirstPhaseQuestions, afaProvider, afaVariants, afaYears } from ".";
import { variantsForReference, variantsToIngest } from "../../catalog/variant";

describe("provider AFA", () => {
  it("expõe somente edições com gabarito final completo", () => {
    expect(afaYears()).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019]);
    for (const year of afaYears()) {
      const key = afaAnswerKey(year)!;
      const questions = afaFirstPhaseQuestions(year);
      expect(questions).toHaveLength(64);
      expect(questions.map((question) => question.number)).toEqual(
        Array.from({ length: 64 }, (_, index) => index + 1),
      );
      expect(key.answerKeyUrl).toMatch(/^https:\/\/www\.fab\.mil\.br\//);
      expect(questions.every((question) => question.statementAvailable === false)).toBe(true);
      expect(questions.every((question) => question.alternatives.map((a) => a.letter).join("") === "ABCD")).toBe(true);
      for (const question of questions) {
        expect(question.correctAlternative).toBe(
          key.annulled.includes(question.number!) ? null : key.answers[String(question.number)],
        );
      }
    }
  });

  it("mantém variantes reordenadas fora da identidade", () => {
    const variants = afaVariants(2026)!;
    expect(variants.relation).toBe("reordered");
    expect(variantsToIngest(variants).map((variant) => variant.id)).toEqual(["a"]);
    expect(variantsForReference(variants).map((variant) => variant.id)).toEqual(["b", "c"]);
    expect(afaProvider.questionKey(afaFirstPhaseQuestions(2026)[0])).toBe("afa-2026-first-1");
  });
});
