import { describe, expect, it } from "vitest";
import type { Question } from "../domain/types";
import type { NativePack } from "./contracts";
import { applyNativePackToQuestions } from "./loader";

function baseQuestion(): Question {
  return {
    providerId: "unesp",
    year: 2026,
    phase: "first",
    index: 1,
    number: 1,
    discipline: "linguagens",
    statementAvailable: false,
    alternatives: ["A", "B", "C", "D", "E"].map((letter) => ({
      letter,
      text: "",
      isCorrect: letter === "C",
    })),
    correctAlternative: "C",
    files: [],
    official: {
      official: false,
      institution: "VUNESP",
      documentUrl: "https://example.com/prova.pdf",
    },
  };
}

function pack(): NativePack {
  return {
    version: 1,
    createdAt: "2026-09-13T22:00:00.000Z",
    documents: [
      {
        documentId: "unesp-2026-first",
        providerId: "unesp",
        year: 2026,
        phase: "first",
        sourceUrl: "https://example.com/prova.pdf",
        sourceSha256: "a".repeat(64),
        sourceBytes: 1000,
        pageCount: 40,
        pageAssetPattern: "native/unesp/2026/first/aaaaaaaaaaaaaaaa/pages/page-{page:03d}.webp",
        renderScale: 1.5,
        imageFormat: "webp",
      },
    ],
    questions: [
      {
        questionKey: "unesp-2026-first-1",
        providerId: "unesp",
        year: 2026,
        phase: "first",
        number: 1,
        documentId: "unesp-2026-first",
        visualRegions: [
          {
            page: 3,
            role: "question",
            rect: { x: 0.05, y: 0.1, width: 0.4, height: 0.25 },
            assetPath: "native/unesp/2026/first/aaaaaaaaaaaaaaaa/questions/q-001-r0-a.webp",
          },
        ],
        semantic: { rawText: "texto extraído" },
        extraction: {
          method: "text-layer",
          parserVersion: "native-pipeline@1.0.0",
          confidence: 1,
          markerDetected: true,
          optionIdsDetected: ["A", "B", "C", "D", "E"],
          issues: [],
        },
        status: "published",
      },
    ],
  };
}

describe("NativePack loader", () => {
  it("torna a questão nativa sem tocar no gabarito do provider", () => {
    const question = baseQuestion();
    const path = pack().questions[0].visualRegions[0].assetPath!;
    const result = applyNativePackToQuestions(
      [question],
      pack(),
      new Map([[path, "https://signed.example.com/q1.webp"]]),
    )[0];

    expect(result.statementAvailable).toBe(true);
    expect(result.files).toContain("https://signed.example.com/q1.webp");
    expect(result.correctAlternative).toBe("C");
    expect(result.alternatives?.find((alternative) => alternative.isCorrect)?.letter).toBe("C");
  });

  it("mantém modo referência se o visual assinado não estiver disponível", () => {
    const question = baseQuestion();
    const result = applyNativePackToQuestions([question], pack(), new Map())[0];
    expect(result).toBe(question);
    expect(result.statementAvailable).toBe(false);
  });

  it("ignora registros ainda não publicados", () => {
    const draft = pack();
    draft.questions[0].status = "review";
    const path = draft.questions[0].visualRegions[0].assetPath!;
    const question = baseQuestion();
    expect(
      applyNativePackToQuestions(
        [question],
        draft,
        new Map([[path, "https://signed.example.com/q1.webp"]]),
      )[0],
    ).toBe(question);
  });
});
