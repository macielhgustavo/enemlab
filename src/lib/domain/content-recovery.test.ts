import { describe, expect, it } from "vitest";
import { makeAttempt, makeDB, makeRow } from "./__fixtures__/db";
import {
  contentNoteKey,
  contentRecoveryEvidence,
  contentRecoveryHref,
  recoveryTaxonomyPath,
  relatedContentErrors,
} from "./content-recovery";

function dbFor(content: string, results: boolean[]) {
  const rows = results.map((correct, index) =>
    makeRow({
      key: `q-${index + 1}`,
      index: index + 1,
      content,
      tags: [content],
      selected: correct ? "A" : "B",
      correct: "A",
      isCorrect: correct,
      area: "matematica",
      confidence: correct ? "certeza" : "duvida",
      finishedAt: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    }),
  );
  return makeDB({
    attempts: [
      makeAttempt({
        id: "attempt-content",
        providerId: "enem",
        result: {
          rows,
          correct: results.filter(Boolean).length,
          total: rows.length,
          blank: 0,
        },
      }),
    ],
  });
}

describe("content recovery", () => {
  it("não chama amostra curta de fraqueza", () => {
    const calibrating = contentRecoveryEvidence(
      dbFor("Probabilidade", [false, false, true]),
      "Probabilidade",
      "enem",
    );
    expect(calibrating.state).toBe("calibrating");
    expect(calibrating.remainingForDecision).toBe(1);

    const weak = contentRecoveryEvidence(
      dbFor("Probabilidade", [false, false, false, true]),
      "Probabilidade",
      "enem",
    );
    expect(weak.state).toBe("weak");
    expect(weak.p).toBe(25);
  });

  it("distingue conteúdo medido de gargalo e conteúdo ainda não testado", () => {
    const db = dbFor("Funções", [true, true, true, false]);
    expect(contentRecoveryEvidence(db, "Funções", "enem").state).toBe("measured");
    expect(contentRecoveryEvidence(db, "Trigonometria", "enem").state).toBe("untested");
  });

  it("mantém href e nota separados por provider", () => {
    expect(contentRecoveryHref("ita", "Física")).toBe("/content/ita/F%C3%ADsica");
    expect(contentNoteKey("enem", "Física")).not.toBe(contentNoteKey("ita", "Física"));
  });

  it("recupera erros relacionados e usa taxonomia disponível", () => {
    const db = dbFor("Porcentagem e juros", [false, true, false, true]);
    db.notes["attempt-content|q-3"] = {
      reason: "Conteúdo",
      text: "Rever fator multiplicativo",
      knew: "nao",
    };

    const errors = relatedContentErrors(db, "Porcentagem e juros", "enem");
    expect(errors).toHaveLength(2);
    expect(errors.find((item) => item.key === "q-3")).toMatchObject({
      key: "q-3",
      reason: "Conteúdo",
      text: "Rever fator multiplicativo",
    });
    expect(recoveryTaxonomyPath(db, "Porcentagem e juros", "enem")).toEqual([
      "Matemática",
      "Aritmética",
      "Porcentagem e juros",
    ]);
  });
});
