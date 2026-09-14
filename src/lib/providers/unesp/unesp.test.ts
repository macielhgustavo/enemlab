import { describe, expect, it } from "vitest";
import { unespFirstPhaseQuestions, unespProvider } from "./index";
import { UNESP_2026_PAGE_COUNT, unespSourcePage } from "./pages";

describe("UNESP 2026 native document mode", () => {
  it("mapeia as 90 questões para páginas do caderno revisado", () => {
    expect(UNESP_2026_PAGE_COUNT).toBe(90);
    expect(unespSourcePage(2026, 1)).toBe(3);
    expect(unespSourcePage(2026, 45)).toBe(18);
    expect(unespSourcePage(2026, 90)).toBe(38);
    expect(unespSourcePage(2025, 1)).toBeNull();
    expect(unespSourcePage(2026, 91)).toBeNull();
  });

  it("anexa página e fragmento ao documento sem alterar o gabarito", () => {
    const questions = unespFirstPhaseQuestions(2026);
    expect(questions).toHaveLength(90);
    for (const question of questions) {
      expect(question.official?.page).toBe(unespSourcePage(2026, question.number!));
      expect(question.official?.documentUrl).toContain(`#page=${question.official?.page}&zoom=page-width`);
      expect(question.correctAlternative).toBeTruthy();
      expect(question.statementAvailable).toBe(false);
    }
  });

  it("o provider executável usa a mesma navegação por página", async () => {
    const questions = await unespProvider.fetchQuestions({ year: 2026 });
    expect(questions[0].official?.page).toBe(3);
    expect(questions[89].official?.page).toBe(38);
  });
});
