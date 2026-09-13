import { describe, expect, it } from "vitest";
import { makeAttempt, makeDB, makeRow } from "../domain/__fixtures__/db";
import { questionKey } from "../domain/classify";
import { questionsFor } from "../providers/access";
import { getProvider } from "../providers";
import {
  buildNextStudyAttempt,
  buildProviderAdaptiveAttempt,
  nextStudyAction,
} from "./provider-study";

function attemptWithRows(providerId: string, rows: ReturnType<typeof makeRow>[]) {
  return makeAttempt({
    providerId,
    result: {
      rows,
      correct: rows.filter((row) => row.isCorrect).length,
      total: rows.length,
      blank: 0,
    },
  });
}

describe("prioridade do ciclo de estudo", () => {
  it("prioriza revisão vencida", () => {
    const db = makeDB({
      srs: {
        "unesp-2026-first-1": {
          providerId: "unesp",
          reps: 0,
          interval: 0,
          due: "2020-01-01T00:00:00.000Z",
          year: 2026,
          index: 1,
          area: "linguagens",
          content: "Interpretação textual",
          language: null,
        },
      },
    });
    expect(nextStudyAction(db, "unesp").kind).toBe("review");
  });

  it("depois da retenção, repara conteúdo abaixo de 65%", () => {
    const rows = [
      makeRow({ key: "u1", providerId: "unesp", content: "Funções", isCorrect: false }),
      makeRow({ key: "u2", providerId: "unesp", content: "Funções", isCorrect: true }),
      makeRow({ key: "u3", providerId: "unesp", content: "Funções", isCorrect: false }),
    ];
    const db = makeDB({ attempts: [attemptWithRows("unesp", rows)] });
    const action = nextStudyAction(db, "unesp");
    expect(action.kind).toBe("weakness");
    expect(action.content).toBe("Funções");
  });

  it("com domínio acima do corte, prioriza erros restantes", () => {
    const rows = [
      makeRow({ key: "u1", providerId: "unesp", content: "Funções", isCorrect: true }),
      makeRow({ key: "u2", providerId: "unesp", content: "Funções", isCorrect: true }),
      makeRow({ key: "u3", providerId: "unesp", content: "Funções", isCorrect: true }),
      makeRow({ key: "u4", providerId: "unesp", content: "Funções", isCorrect: false }),
    ];
    const db = makeDB({ attempts: [attemptWithRows("unesp", rows)] });
    expect(nextStudyAction(db, "unesp").kind).toBe("retry");
  });

  it("sem histórico, começa por inéditas", () => {
    expect(nextStudyAction(makeDB(), "unesp").kind).toBe("unseen");
  });

  it("sem dívida de retenção, fraqueza ou erro, avança para adaptive", () => {
    const rows = [
      makeRow({ key: "u1", providerId: "unesp", content: "Funções", isCorrect: true }),
      makeRow({ key: "u2", providerId: "unesp", content: "Funções", isCorrect: true }),
    ];
    const db = makeDB({ attempts: [attemptWithRows("unesp", rows)] });
    expect(nextStudyAction(db, "unesp").kind).toBe("adaptive");
  });
});

describe("builders genéricos", () => {
  it("monta Adaptive da UNESP usando o provider correto", async () => {
    const attempt = await buildProviderAdaptiveAttempt(makeDB(), "unesp", 15);
    expect(attempt.providerId).toBe("unesp");
    expect(attempt.mode).toBe("adaptive");
    expect(attempt.questionRefs).toHaveLength(15);
    expect(attempt.questionRefs.every((ref) => ref.providerId === "unesp")).toBe(true);
  });

  it("resolve revisão pela questionKey quando há várias edições EEAR no mesmo ano", async () => {
    const editions = getProvider("eear").metadata.editions?.filter((edition) => edition.year === 2025) ?? [];
    expect(editions.length).toBeGreaterThanOrEqual(2);

    const targetEdition = editions[1];
    const questions = await questionsFor("eear", {
      year: 2025,
      editionId: targetEdition.id,
      language: "ingles",
    });
    const target = questions[0];
    const key = questionKey(target);
    const db = makeDB({
      srs: {
        [key]: {
          providerId: "eear",
          reps: 0,
          interval: 0,
          due: "2020-01-01T00:00:00.000Z",
          year: 2025,
          index: target.index,
          area: typeof target.discipline === "string" ? target.discipline : "",
          content: "revisão",
          language: target.language,
        },
      },
    });

    const attempt = await buildNextStudyAttempt(db, "eear", 1);
    expect(attempt.mode).toBe("srs");
    expect(attempt.questionRefs).toHaveLength(1);
    expect(attempt.questionRefs[0].questionKey).toBe(key);
  });
});
