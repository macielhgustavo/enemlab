import { describe, expect, it } from "vitest";
import { epcarAnswerKey, epcarFirstPhaseQuestions, epcarProvider, epcarVariants, epcarYears } from ".";
import { variantsForReference, variantsToIngest } from "../../catalog/variant";

describe("provider EPCAR", () => {
  it("expõe somente edições com gabarito final completo", () => {
    expect(epcarYears()).toEqual([2025, 2023, 2020]);
    for (const year of epcarYears()) {
      const key = epcarAnswerKey(year)!;
      const questions = epcarFirstPhaseQuestions(year);
      expect(questions).toHaveLength(48);
      expect(questions.map((question) => question.number)).toEqual(
        Array.from({ length: 48 }, (_, index) => index + 1),
      );
      expect(key.answerKeyUrl).toMatch(/^https:\/\/www\.fab\.mil\.br\//);
      expect(questions.every((question) => question.statementAvailable === false)).toBe(true);
      expect(questions.every((question) => question.alternatives.map((a) => a.letter).join("") === "ABCD")).toBe(true);
    }
  });

  it("isola o provider e conserva a versão A como canônica", () => {
    const variants = epcarVariants(2025)!;
    expect(variants.relation).toBe("reordered");
    expect(variantsToIngest(variants).map((variant) => variant.id)).toEqual(["a"]);
    expect(variantsForReference(variants).map((variant) => variant.id)).toEqual(["b", "c"]);
    expect(epcarProvider.questionKey(epcarFirstPhaseQuestions(2025)[47])).toBe("epcar-2025-first-48");
    expect(epcarFirstPhaseQuestions(2025)[0].providerId).toBe("epcar");
  });
});
