import { describe, expect, it } from "vitest";
import { auditQuestionSet, inspectQuestion, isQuestionUsableForPractice } from "./question-quality";
import type { Question } from "./types";

function base(extra: Partial<Question> = {}): Question {
  return {
    year: 2023,
    index: 1,
    discipline: "matematica",
    context: "Um capital é aplicado a juros compostos. Qual é o montante após o período indicado?",
    alternativesIntroduction: "Assinale a alternativa correta.",
    alternatives: [
      { letter: "A", text: "R$ 100", isCorrect: true },
      { letter: "B", text: "R$ 110" },
      { letter: "C", text: "R$ 120" },
      { letter: "D", text: "R$ 130" },
      { letter: "E", text: "R$ 140" },
    ],
    correctAlternative: "A",
    files: [],
    ...extra,
  };
}

describe("inspectQuestion", () => {
  it("accepts a structurally complete and classifiable question", () => {
    const report = inspectQuestion(base());
    expect(report.status).toBe("healthy");
    expect(report.scoreable).toBe(true);
    expect(report.score).toBe(100);
  });

  it("flags mojibake without blocking a scoreable question", () => {
    const report = inspectQuestion(base({ context: "Uma aplicaÃ§Ã£o a juros compostos gera um montante." }));
    expect(report.status).toBe("review");
    expect(report.issues.some((x) => x.code === "mojibake")).toBe(true);
    expect(report.scoreable).toBe(true);
  });

  it("blocks questions with no answer key", () => {
    const alternatives = base().alternatives!.map((a) => ({ ...a, isCorrect: false }));
    const report = inspectQuestion(base({ correctAlternative: undefined, alternatives }));
    expect(report.status).toBe("blocked");
    expect(report.scoreable).toBe(false);
    expect(report.issues.some((x) => x.code === "missing-answer-key")).toBe(true);
    expect(isQuestionUsableForPractice(base({ correctAlternative: undefined, alternatives }))).toBe(false);
  });

  it("detects duplicate letters and empty alternatives", () => {
    const report = inspectQuestion(
      base({
        alternatives: [
          { letter: "A", text: "1", isCorrect: true },
          { letter: "A", text: "" },
          { letter: "C", text: "3" },
          { letter: "D", text: "4" },
          { letter: "E", text: "5" },
        ],
      }),
    );
    expect(report.status).toBe("blocked");
    expect(report.issues.some((x) => x.code === "duplicate-alternative-letter")).toBe(true);
    expect(report.issues.some((x) => x.code === "empty-alternative")).toBe(true);
  });

  it("summarizes a set without hiding problematic questions", () => {
    const brokenAlternatives = base().alternatives!.map((a) => ({ ...a, isCorrect: false }));
    const audit = auditQuestionSet([
      base(),
      base({ index: 2, context: "Uma aplicaÃ§Ã£o a juros compostos." }),
      base({ index: 3, correctAlternative: undefined, alternatives: brokenAlternatives }),
    ]);
    expect(audit.total).toBe(3);
    expect(audit.healthy).toBe(1);
    expect(audit.review).toBe(1);
    expect(audit.blocked).toBe(1);
    expect(audit.scoreable).toBe(2);
    expect(audit.issueCounts.some((x) => x.code === "mojibake")).toBe(true);
  });
});
